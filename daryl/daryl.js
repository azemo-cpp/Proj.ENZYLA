/* Self-diagnosing Daryl: type questions, get answers checked by the pipeline.*/
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { runDiagnosticCycle } from "./protected/run.js";
import { createDarylProvider, SITES } from "./providers/lunar/index.js";
import { summarizeIncidents } from "./diagnostics/learning.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const date = arg("date");
let daryl;
try {
  daryl = createDarylProvider({
    siteA: Number(arg("a", 0)),
    siteB: Number(arg("b", Math.min(4, SITES.length - 1))),
    days: Number(arg("days", 14)),
    mask: Number(arg("mask", 1)),
    startMs: date ? Date.parse(`${date}T00:00:00Z`) : undefined
  });
} catch (error) {
  console.error(error.message); // halimbawa: walang laman ang database/sites.js
  process.exit(1);
}

const [a, b] = daryl.settings.current;
console.log(`Daryl (self-diagnosing). ${SITES[a][0]} vs ${SITES[b][0]}, ${daryl.settings.N / 24} days.`);
console.log('Type a question. Commands: "/incidents" for recurring problems, "/quit" to exit.\n');

const rl = readline.createInterface({ input, output });

while (true) {
  const line = (await rl.question("You: ")).trim();
  if (line === "/quit") break;

  if (line === "/incidents") {
    console.log(await summarizeIncidents(), "\n");
    continue;
  }

  const result = await runDiagnosticCycle(line, daryl, { timeoutMs: 15000 });

  if (result.status === "SUCCESS") {
    console.log(`\nDaryl: ${result.output}\n`);
  } else {
    console.log(`\n[${result.status}]`, result.reason ?? "");
    if (result.diagnosis) {
      console.log(`Cause: ${result.diagnosis.cause}`);
      console.log(`Suggestion: ${result.diagnosis.suggestion}`);
    }
    console.log();
  }
}

rl.close();
