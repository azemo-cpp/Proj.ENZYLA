import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parsePatch, validateChanges, applyChanges, findRisks, patchHash, PatchError
} from "../doctor/patch.js";
import { testInSandbox, sandboxSupport } from "../doctor/sandbox.js";
import { proposeFix } from "../doctor/doctor.js";
import { SITES_FILE } from "../database/sites.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Ang mga test na nagpapatakbo ng sandbox ay nag-i-spawn ng process, kaya
skip sila kapag nasa loob na ng sandbox, o kapag luma ang Node. */
const insideSandbox = Boolean(process.permission);
const support = insideSandbox ? { ok: false } : await sandboxSupport();
const e2e = { skip: !support.ok };

const block = (file, find, replace) =>
  `FILE: ${file}\n<<<<<<< FIND\n${find}\n=======\n${replace}\n>>>>>>> REPLACE`;
const create = (file, content) => `FILE: ${file}\n<<<<<<< CREATE\n${content}\n>>>>>>> END`;

/* A tiny fake project with a bug that no existing test covers (add subtracts). */
async function fixture({ breakBaseline = false } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fix-"));
  await mkdir(path.join(dir, "tests"));
  await writeFile(path.join(dir, "package.json"), '{"type":"module"}');
  await writeFile(path.join(dir, "math.js"),
    "export const add = (a, b) => a - b;\nexport const mul = (a, b) => a * b;\n");
  await writeFile(path.join(dir, "tests", "mul.test.js"),
    `import test from "node:test";\nimport assert from "node:assert/strict";\n` +
    `import { mul } from "../math.js";\ntest("mul", () => assert.equal(mul(2, 3), ${breakBaseline ? 7 : 6}));\n`);
  return dir;
}

const addTest =
  `import test from "node:test";\nimport assert from "node:assert/strict";\n` +
  `import { add } from "../math.js";\ntest("add", () => assert.equal(add(2, 3), 5));`;

test("parsePatch reads replace and create blocks, including CRLF and code fences", () => {
  const text = "Explanation\n```\n" +
    [block("a.js", "old()", "new()"), create("tests/x.test.js", "// hi")].join("\n\n").replace(/\n/g, "\r\n") +
    "\n```";
  const { changes } = parsePatch(text);
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0], { type: "replace", file: "a.js", find: "old()", replace: "new()" });
  assert.deepEqual(changes[1], { type: "create", file: "tests/x.test.js", content: "// hi" });
});

test("parsePatch allows an empty replacement and ignores plain text", () => {
  assert.equal(parsePatch(block("a.js", "x", "")).changes[0].replace, "");
  assert.equal(parsePatch("just words, no blocks").changes.length, 0);
});

test("validateChanges blocks protected files, escapes, secrets, and test edits", () => {
  const bad = [
    ["protected/master.js", "replace"], ["../outside.js", "replace"], ["/etc/x.js", "replace"],
    ["C:/x.js", "replace"], ["memory/a.js", "replace"], ["doctor/doctor.js", "replace"],
    ["package.json", "replace"], [".env.js", "replace"], ["notes.txt", "replace"],
    ["tests/system.test.js", "replace"], ["sandbox.js", "replace"]
  ];
  for (const [file, type] of bad) {
    const change = { type, file, find: "a", replace: "b" };
    assert.equal(validateChanges([change]).ok, false, file);
  }
  assert.equal(validateChanges([]).ok, false);
});

test("validateChanges accepts a normal edit and a new test file", () => {
  const changes = [
    { type: "replace", file: "providers/lunar/planner.js", find: "a", replace: "b" },
    { type: "create", file: "tests/new.test.js", content: "// ok" }
  ];
  assert.equal(validateChanges(changes).ok, true);
});

test("risky code in the new text is rejected", () => {
  assert.deepEqual(findRisks("import { exec } from 'node:child_process'"), ["child_process"]);
  assert.ok(findRisks("await fetch('http://x')").includes("network"));
  assert.ok(findRisks("eval('1')").includes("eval"));
  assert.ok(findRisks("process.env.KEY").includes("process.env"));
  assert.deepEqual(findRisks("const x = 1 + 1;"), []);
  const change = { type: "replace", file: "a.js", find: "a", replace: "eval('x')" };
  assert.equal(validateChanges([change]).ok, false);
});

test("applyChanges needs the FIND text to match exactly once", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apply-"));
  await writeFile(path.join(dir, "a.js"), "one\ntwo\ntwo\n");

  const run = change => applyChanges(dir, [{ type: "replace", file: "a.js", ...change }]);
  await assert.rejects(run({ find: "missing", replace: "x" }), /matched 0 times/);
  await assert.rejects(run({ find: "two", replace: "x" }), /matched 2 times/);
  await assert.rejects(run({ find: "", replace: "x" }), PatchError);

  await run({ find: "one", replace: "cost $& now" }); // "$&" must stay as typed
  assert.equal(await readFile(path.join(dir, "a.js"), "utf8"), "cost $& now\ntwo\ntwo\n");
});

test("applyChanges won't overwrite an existing file or leave the folder", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apply-"));
  await writeFile(path.join(dir, "a.js"), "x");
  await assert.rejects(applyChanges(dir, [{ type: "create", file: "a.js", content: "y" }]), /already exists/);
  await assert.rejects(applyChanges(dir, [{ type: "create", file: "../z.js", content: "y" }]), /outside/);
});

test("the same changes give the same fingerprint", () => {
  const a = parsePatch(block("a.js", "x", "y")).changes;
  const b = parsePatch(block("a.js", "x", "y")).changes;
  const c = parsePatch(block("a.js", "x", "z")).changes;
  assert.equal(patchHash(a), patchHash(b));
  assert.notEqual(patchHash(a), patchHash(c));
});

test("the doctor's proposal includes the parsed changes", async () => {
  const doctor = { run: async () => `Fix it.\n\n${block("a.js", "x", "y")}` };
  const result = await proposeFix({ task: "t" }, [], doctor);
  assert.equal(result.status, "PROPOSAL_ONLY");
  assert.equal(result.changes.length, 1);
});

test("a fix plus a new test passes in the sandbox, and the real files stay untouched", e2e, async () => {
  const dir = await fixture();
  const changes = parsePatch([
    block("math.js", "export const add = (a, b) => a - b;", "export const add = (a, b) => a + b;"),
    create("tests/add.test.js", addTest)
  ].join("\n\n")).changes;

  const result = await testInSandbox({ root: dir, changes });
  assert.equal(result.status, "TESTS_PASSED");
  assert.equal(result.testCheck.passed, true);
  assert.equal(result.patched.tests, 2);

  assert.match(await readFile(path.join(dir, "math.js"), "utf8"), /a - b/);
  await assert.rejects(stat(path.join(dir, "tests", "add.test.js")));
  assert.deepEqual(await readdir(path.join(dir, "sandbox")), []); // copy was cleaned up
});

test("a change that breaks an existing test is caught", e2e, async () => {
  const dir = await fixture();
  const changes = parsePatch(block("math.js", "a * b", "a + b")).changes;
  const result = await testInSandbox({ root: dir, changes });
  assert.equal(result.status, "TESTS_FAILED");
  assert.equal(result.testCheck.passed, false);
});

test("a FIND that doesn't match stops before running anything", e2e, async () => {
  const dir = await fixture();
  const changes = parsePatch(block("math.js", "not in the file", "x")).changes;
  const result = await testInSandbox({ root: dir, changes });
  assert.equal(result.status, "APPLY_FAILED");
  assert.equal(result.patched, undefined);
});

test("if tests already fail before the change, it says so", e2e, async () => {
  const dir = await fixture({ breakBaseline: true });
  const changes = parsePatch(block("math.js", "a - b", "a + b")).changes;
  const result = await testInSandbox({ root: dir, changes });
  assert.equal(result.status, "BASELINE_FAILING");
});

test("a rejected change never reaches the sandbox", e2e, async () => {
  const dir = await fixture();
  const changes = parsePatch(block("protected/master.js", "a", "b")).changes;
  const result = await testInSandbox({ root: dir, changes });
  assert.equal(result.status, "REJECTED");
});

test("code that tries to write outside the copy is blocked", e2e, async () => {
  const dir = await fixture();
  const outside = path.join(os.tmpdir(), `escape-${Date.now()}.txt`);
  const sneaky =
    `import test from "node:test";\nimport { writeFileSync } from "node:fs";\n` +
    `test("escape", () => writeFileSync(${JSON.stringify(outside)}, "oops"));`;
  const changes = parsePatch(create("tests/escape.test.js", sneaky)).changes;

  const result = await testInSandbox({ root: dir, changes });
  assert.equal(result.status, "TESTS_FAILED");
  await assert.rejects(stat(outside)); // the file was never written
});

test("a hanging test is stopped by the timeout", e2e, async () => {
  const dir = await fixture();
  const hang = `import test from "node:test";\ntest("hang", () => new Promise(() => setInterval(() => {}, 1000)));`;
  const changes = parsePatch(create("tests/hang.test.js", hang)).changes;
  const result = await testInSandbox({ root: dir, changes, timeoutMs: 4000 });
  assert.equal(result.status, "TESTS_FAILED");
  assert.equal(result.patched.timedOut, true);
});

test("the real project's own tests pass inside the sandbox", e2e, async () => {
  const note = "// harmless\nimport test from 'node:test';\ntest('placeholder', () => {});";
  const changes = parsePatch(create("tests/zz-sandbox-check.test.js", note)).changes;
  const result = await testInSandbox({
    root: projectRoot, changes, timeoutMs: 120000,
    dataFiles: { DARYL_SITES_FILE: SITES_FILE }
  });
  assert.equal(result.status, "TESTS_PASSED", result.baseline?.outputTail ?? result.patched?.outputTail);
});
