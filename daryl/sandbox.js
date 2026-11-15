/* Tests a doctor proposal in a copy of the project (sandbox) bago mo ito i-apply.
Hindi nito ginagalaw ang real files mo. Usage: node sandbox.js proposals/<file>.md [--keep] [--yes] */
import readline from "node:readline/promises";
import { readFile, writeFile } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePatch, validateChanges } from "./doctor/patch.js";
import { testInSandbox } from "./doctor/sandbox.js";
import { SITES_FILE } from "./database/sites.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith("--"));

if (!target) {
  console.log("Usage: node sandbox.js proposals/<file>.md [--keep] [--yes]");
  process.exit(1);
}

let file;
let text;
for (const candidate of [path.resolve(root, target), path.resolve(root, "proposals", target)]) {
  try {
    text = await readFile(candidate, "utf8");
    file = candidate;
    break;
  } catch {}
}
if (!file) {
  console.log(`Can't find ${target}.`);
  process.exit(1);
}

const { changes } = parsePatch(text);
const check = validateChanges(changes);

console.log(`\nProposal: ${path.relative(root, file)}`);
console.log(`Changes found: ${changes.length}\n`);

for (const change of changes) {
  console.log(`FILE: ${change.file} (${change.type})`);
  if (change.type === "replace") {
    change.find.split("\n").forEach(l => console.log(`- ${l}`));
    change.replace.split("\n").forEach(l => console.log(`+ ${l}`));
  } else {
    change.content.split("\n").forEach(l => console.log(`+ ${l}`));
  }
  console.log();
}

if (!check.ok) {
  console.log("Can't test this proposal:");
  check.problems.forEach(p => console.log(`  - ${p}`));
  process.exit(1);
}

if (!args.includes("--yes")) {
  const rl = readline.createInterface({ input, output });
  const answer = (await rl.question("Read the changes above. Run the tests on a copy? (y/n) ")).trim().toLowerCase();
  rl.close();
  if (answer !== "y") {
    console.log("Cancelled. Nothing was run.");
    process.exit(0);
  }
}

console.log("\nRunning tests on a copy. Ito ay baka matagalan ng ilang segundo...\n");
const result = await testInSandbox({
  root, changes, keep: args.includes("--keep"),
  dataFiles: { DARYL_SITES_FILE: SITES_FILE } // ang apolloSites.ts ay nasa labas ng daryl folder
});

const lines = [`Status: ${result.status}`];
if (result.reason) lines.push(result.reason);
if (result.problems) lines.push(...result.problems);
if (result.baseline) lines.push(`Before the change: ${result.baseline.pass} passed, ${result.baseline.fail} failed, ${result.baseline.skipped} skipped.`);
if (result.patched) lines.push(`After the change:  ${result.patched.pass} passed, ${result.patched.fail} failed, ${result.patched.skipped} skipped.`);
if (result.keptAt) lines.push(`Copy kept at: ${result.keptAt}`);
lines.push(`Patch fingerprint: ${result.patchHash.slice(0, 12)}`);
console.log(lines.join("\n"));

const failedRun = result.status === "BASELINE_FAILING" ? result.baseline : result.status === "TESTS_FAILED" ? result.patched : null;
if (failedRun) console.log(`\nLast test output:\n${failedRun.outputTail}`);

if (result.status === "TESTS_PASSED") {
  console.log(
    "\nThe tests passed on the copy. Your real files were not touched.\n" +
    "Review the changes, then edit your real files by hand and run npm.cmd test.\n" +
    "Note: passing means no existing test broke and any new tests passed. It doesn't prove the original problem is fixed."
  );
}

await writeFile(
  file.replace(/\.md$/, "") + ".result.md",
  `# Sandbox result\n\n${lines.join("\n")}\n\nRun at ${new Date().toISOString()}\n`
);

process.exit(result.status === "TESTS_PASSED" ? 0 : 1);
