/* Reads the doctor's reply and pulls out the proposed changes.
Dalawang klase ng block: FIND/REPLACE (edit ng file) at CREATE (bagong file). */
import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";

const MAX_CHANGES = 20;
const MAX_TEXT = 20000;

// mga folder na hindi pwedeng galawin ng doctor
const BLOCKED_FOLDERS = new Set([
  "protected", "sandbox", "proposals", "memory", "node_modules", ".git", "doctor"
]);

// mga file na hindi pwedeng galawin ng doctor
const BLOCKED_FILES = new Set([
  "package.json", "package-lock.json", "doctor.js", "sandbox.js",
  "diagnostics/test-runner.js", "diagnostics/testing.js"
]);

const ALLOWED_EXTENSIONS = new Set([".js", ".mjs"]);

/* Quick screen for risky code in the new text. Hindi ito security guarantee,
pang-sala lang ng obvious na delikado. */
const RISKY = [
  ["child_process", /child_process/],
  ["eval", /\beval\s*\(/],
  ["new Function", /new\s+Function\b/],
  ["vm module", /node:vm|from\s+["']vm["']/],
  ["worker threads", /worker_threads/],
  ["network", /node:(net|http|https|http2|dgram|dns|tls)\b|from\s+["'](net|http|https|http2|dgram|dns|tls)["']|\bfetch\s*\(|WebSocket|XMLHttpRequest/],
  ["process.env", /process\.env/],
  ["process control", /process\.(binding|kill|chdir|dlopen|reallyExit)/],
  ["dynamic import", /\bimport\s*\(/]
];

const FIND_BLOCK =
  /^FILE:[ \t]*(.+?)[ \t]*\n<<<<<<< FIND\n([\s\S]*?)\n=======\n([\s\S]*?)>>>>>>> REPLACE[ \t]*$/gm;
const CREATE_BLOCK =
  /^FILE:[ \t]*(.+?)[ \t]*\n<<<<<<< CREATE\n([\s\S]*?)>>>>>>> END[ \t]*$/gm;

const dropLastNewline = s => (s.endsWith("\n") ? s.slice(0, -1) : s);

function cleanFile(file) {
  const unquoted = String(file).trim().replace(/^[`"']+|[`"']+$/g, "");
  return path.posix.normalize(unquoted.replace(/\\/g, "/")).replace(/^\.\//, "");
}

export function parsePatch(text) {
  const source = String(text ?? "").replace(/\r\n/g, "\n");
  const found = [];

  for (const m of source.matchAll(FIND_BLOCK)) {
    found.push({
      index: m.index,
      change: {
        type: "replace",
        file: cleanFile(m[1]),
        find: m[2],
        replace: dropLastNewline(m[3])
      }
    });
  }

  for (const m of source.matchAll(CREATE_BLOCK)) {
    found.push({
      index: m.index,
      change: { type: "create", file: cleanFile(m[1]), content: dropLastNewline(m[2]) }
    });
  }

  found.sort((a, b) => a.index - b.index);
  return { changes: found.map(f => f.change) };
}

// Same changes always give the same hash, para malaman kung iyon pa rin ang na-test.
export function patchHash(changes) {
  return createHash("sha256").update(JSON.stringify(changes)).digest("hex");
}

export function findRisks(text) {
  return RISKY.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

export function validateChanges(changes) {
  const problems = [];

  if (!Array.isArray(changes) || changes.length === 0) {
    problems.push("No changes were found. Use the FIND/REPLACE or CREATE block format.");
    return { ok: false, problems };
  }
  if (changes.length > MAX_CHANGES) {
    problems.push(`Too many changes (${changes.length}). The limit is ${MAX_CHANGES}.`);
  }

  for (const change of changes) {
    const file = change.file;
    const segments = file.split("/");
    const top = segments[0].toLowerCase();
    const name = segments[segments.length - 1].toLowerCase();
    const label = `${file}:`;

    if (!file || file.includes("\0") || /^([a-zA-Z]:|\/)/.test(file) || segments.includes("..")) {
      problems.push(`${label} path is outside the project.`);
      continue;
    }
    if (BLOCKED_FOLDERS.has(top)) problems.push(`${label} the doctor can't change the "${top}" folder.`);
    if (BLOCKED_FILES.has(file.toLowerCase())) problems.push(`${label} the doctor can't change this file.`);
    if (name.startsWith(".env")) problems.push(`${label} secret files are off limits.`);
    if (!ALLOWED_EXTENSIONS.has(path.posix.extname(name))) {
      problems.push(`${label} only .js and .mjs files are allowed.`);
    }
    if (change.type === "replace" && top === "tests") {
      problems.push(`${label} existing tests can't be edited. Add a new test file instead.`);
    }

    const added = change.type === "create" ? change.content : change.replace;
    if (change.type === "replace" && !change.find) problems.push(`${label} FIND text is empty.`);
    if (added.length > MAX_TEXT || (change.find ?? "").length > MAX_TEXT) {
      problems.push(`${label} text is too long.`);
    }

    const risks = findRisks(added);
    if (risks.length) {
      problems.push(`${label} new code uses something risky (${risks.join(", ")}). Do this one by hand.`);
    }
  }

  return { ok: problems.length === 0, problems };
}

export class PatchError extends Error {}

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

// Applies the changes inside dir. Each FIND must match exactly once.
export async function applyChanges(dir, changes) {
  const base = path.resolve(dir);

  for (const change of changes) {
    const target = path.resolve(base, change.file);
    if (!target.startsWith(base + path.sep)) {
      throw new PatchError(`${change.file}: outside the project.`);
    }

    if (change.type === "create") {
      if (await exists(target)) throw new PatchError(`${change.file}: file already exists.`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, change.content.endsWith("\n") ? change.content : change.content + "\n");
      continue;
    }

    let original;
    try {
      original = await readFile(target, "utf8");
    } catch {
      throw new PatchError(`${change.file}: file not found.`);
    }

    const count = original.split(change.find).length - 1;
    if (count !== 1) {
      throw new PatchError(
        `${change.file}: the FIND text matched ${count} times (it must match exactly once).`
      );
    }

    // function form, para hindi ma-interpret ang "$" sa replacement
    await writeFile(target, original.replace(change.find, () => change.replace));
  }
}
