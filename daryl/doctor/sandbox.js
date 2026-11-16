/* Tests a proposed change in a copy of the project, hindi sa real files mo.
Ang copy ay tumatakbo sa Node permission model: puwede lang magsulat sa copy,
at hindi makapag-start ng ibang program. Hindi pa rin ito VM o container. */
import { mkdir, readdir, copyFile, rm, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { applyChanges, patchHash, PatchError, validateChanges } from "./patch.js";
import { verifyTests } from "../diagnostics/testing.js";

// these only get skipped at the top level of the project
const SKIP_TOP = new Set(["sandbox", "proposals", "memory", "node_modules", ".git"]);

function run(args, options) {
  return new Promise(resolve => {
    execFile(process.execPath, args, options, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

let supportCache;

// Needs a Node with --permission and --experimental-test-isolation (Node 22.8 or newer).
export async function sandboxSupport() {
  if (supportCache) return supportCache;

  const flags = process.allowedNodeEnvironmentFlags;
  const permission = flags.has("--permission")
    ? "--permission"
    : flags.has("--experimental-permission")
      ? "--experimental-permission"
      : null;

  if (!permission) {
    supportCache = { ok: false, reason: "This Node.js has no permission model. Update to Node 22.8 or newer." };
    return supportCache;
  }

  const probe = await run(
    [permission, "--experimental-test-isolation=none", "-e", "0"],
    { timeout: 10000 }
  );
  supportCache = probe.error
    ? { ok: false, reason: "This Node.js can't run tests in-process. Update to Node 22.8 or newer." }
    : { ok: true, permission };
  return supportCache;
}

async function copyProject(src, dest, top = true) {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const name = entry.name.toLowerCase();
    if ((top && SKIP_TOP.has(name)) || name.startsWith(".env")) continue;

    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyProject(from, to, false);
    else if (entry.isFile()) await copyFile(from, to); // symlinks are skipped
  }
}

// Runs the project's tests inside dir with limited permissions.
async function runRestricted(dir, permission, timeoutMs, extraEnv = {}) {
  const scratch = path.join(dir, ".tmp");
  await mkdir(scratch, { recursive: true });

  // minimal environment: walang API keys o secrets na makikita ng code
  const env = {
    PATH: process.env.PATH,
    TMPDIR: scratch, TEMP: scratch, TMP: scratch,
    HOME: dir, USERPROFILE: dir,
    ...extraEnv
  };
  for (const key of ["SystemRoot", "windir"]) {
    if (process.env[key]) env[key] = process.env[key];
  }

  const args = [
    permission,
    `--allow-fs-read=${dir}`,
    `--allow-fs-write=${dir}`,
    "--experimental-test-isolation=none",
    "--test-reporter=tap",
    "--test"
  ];

  const { error, stdout, stderr } = await run(args, {
    cwd: dir, env, timeout: timeoutMs, killSignal: "SIGKILL",
    maxBuffer: 5 * 1024 * 1024, windowsHide: true
  });

  const count = name => Number(stdout.match(new RegExp(`^# ${name} (\\d+)`, "m"))?.[1] ?? 0);
  const timedOut = Boolean(error?.killed);
  const summary = {
    tests: count("tests"), pass: count("pass"), fail: count("fail"), skipped: count("skipped"),
    timedOut,
    outputTail: `${stdout}\n${stderr}`.trim().slice(-2500)
  };
  summary.passed = !error && !timedOut && summary.tests > 0 && summary.fail === 0;
  return summary;
}

/* dataFiles: { ENV_NAME: "/path/to/file" } para sa mga file na nasa labas ng project (gaya ng apolloSites.ts).
Kinokopya ang file sa loob ng sandbox at ang ENV_NAME ay tumuturo sa kopya, kaya hindi lumalabas sa copy ang code. */
export async function testInSandbox({ root, changes, timeoutMs = 60000, keep = false, dataFiles = {} }) {
  const hash = patchHash(changes);

  const check = validateChanges(changes);
  if (!check.ok) return { status: "REJECTED", problems: check.problems, patchHash: hash };

  const support = await sandboxSupport();
  if (!support.ok) return { status: "SANDBOX_UNAVAILABLE", reason: support.reason, patchHash: hash };

  const dir = path.resolve(root, "sandbox", `run-${Date.now()}-${randomBytes(3).toString("hex")}`);
  if (dir.includes(",")) {
    return { status: "SANDBOX_UNAVAILABLE", reason: "The project path can't contain a comma.", patchHash: hash };
  }

  try {
    await copyProject(path.resolve(root), dir);

    const extraEnv = {};
    for (const [name, source] of Object.entries(dataFiles)) {
      try { await stat(source); } catch { continue; } // wala ang file, okay lang
      const target = path.join(dir, ".data", name, path.basename(source));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      extraEnv[name] = target;
    }

    // 1. baseline: pasado ba ang tests bago ang change?
    const baseline = await runRestricted(dir, support.permission, timeoutMs, extraEnv);
    if (!baseline.passed) {
      return { status: "BASELINE_FAILING", baseline, patchHash: hash };
    }

    // 2. apply the change sa copy lang
    try {
      await applyChanges(dir, changes);
    } catch (error) {
      if (error instanceof PatchError) {
        return { status: "APPLY_FAILED", reason: error.message, baseline, patchHash: hash };
      }
      throw error;
    }

    // 3. run the tests ulit
    const patched = await runRestricted(dir, support.permission, timeoutMs, extraEnv);
    const testCheck = verifyTests([{ name: "node --test (patched copy)", passed: patched.passed }]);

    return {
      status: patched.passed ? "TESTS_PASSED" : "TESTS_FAILED",
      baseline, patched, testCheck, patchHash: hash,
      ...(keep ? { keptAt: dir } : {})
    };
  } finally {
    if (!keep) await rm(dir, { recursive: true, force: true });
  }
}
