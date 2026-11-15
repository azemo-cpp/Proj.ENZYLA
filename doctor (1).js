/* Asks a free local AI (Ollama) to look at the latest incident and propose a fix.
It only writes a proposal file, never edits your code. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getIncidents } from "./diagnostics/learning.js";
import { createOllamaProvider } from "./providers/ollama.js";
import { OLLAMA } from "./providers/ollama.config.js";
import { proposeFix } from "./doctor/doctor.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const incidents = await getIncidents();
if (incidents.length === 0) {
  console.log("No incidents recorded yet. Nothing to diagnose.");
  process.exit(0);
}

const index = Number(arg("index", -1));
const incident = incidents.at(index);
if (!incident) {
  console.log(`No incident at index ${index}.`);
  process.exit(1);
}

const fileList = arg("files", "providers/lunar/index.js,providers/lunar/planner.js").split(",");
const files = [];
for (const name of fileList.map(f => f.trim())) {
  const full = path.resolve(root, name);
  const relative = path.relative(root, full);
  if (relative.startsWith("..") || relative.split(path.sep)[0] === "protected") {
    console.log(`Skipping ${name}: outside the project or protected.`);
    continue;
  }
  files.push({ name: relative, content: await readFile(full, "utf8") });
}

const provider = createOllamaProvider({ model: arg("model", OLLAMA.doctorModel) });
console.log(`Asking ${provider.name} about: ${incident.diagnosis?.cause} ...`);

const proposal = await proposeFix(incident, files, provider);

if (proposal.status === "DOCTOR_FAILED") {
  console.log(`Doctor failed: ${proposal.reason}`);
  process.exit(1);
}

await mkdir(path.join(root, "proposals"), { recursive: true });
const file = path.join(root, "proposals", `${Date.now()}.md`);
await writeFile(
  file,
  `# Proposal (${proposal.status})\n\nIncident: ${incident.status} / ${incident.diagnosis?.cause}\n\n${proposal.text}\n`
);

console.log(`\n[${proposal.status}] ${proposal.note ?? proposal.reason}\n`);
console.log(proposal.text);
console.log(`\nSaved to ${path.relative(root, file)}`);

if (proposal.changes?.length) {
  console.log(`Found ${proposal.changes.length} change(s). Test them in the sandbox with:`);
  console.log(`  node sandbox.js ${path.relative(root, file)}`);
} else {
  console.log("No FIND/REPLACE blocks found, so there is nothing to test in the sandbox yet.");
}
