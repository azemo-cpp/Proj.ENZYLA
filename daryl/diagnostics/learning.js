import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.resolve(here, "../memory/incidents.json");
const MAX_INCIDENTS = 1000;

export function createIncidentStore(file = DEFAULT_FILE) {
  // Writes run one at a time so simultaneous incidents can't overwrite
  // each other (within this process).
  let queue = Promise.resolve();

  async function read() {
    let data;
    try {
      data = await readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }

    if (!data.trim()) return [];

    let incidents;
    try {
      incidents = JSON.parse(data);
    } catch {
      throw new Error(`Incident file is corrupted: ${file}`);
    }

    if (!Array.isArray(incidents)) {
      throw new Error("Incident file must contain an array.");
    }
    return incidents;
  }

  async function write(incidents) {
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await writeFile(temp, JSON.stringify(incidents, null, 2), "utf8");
    await rename(temp, file); // replaces the file in one step
  }

  function record(incident) {
    const job = queue.then(async () => {
      const incidents = await read();
      incidents.push({ ...incident, recordedAt: new Date().toISOString() });
      const kept = incidents.slice(-MAX_INCIDENTS);
      await write(kept);
      return kept.length;
    });
    queue = job.catch(() => {}); // one failure doesn't block later writes
    return job;
  }

  // Counts incidents by diagnosed cause so recurring problems stand out.
  async function summarize() {
    const counts = {};
    for (const incident of await read()) {
      const cause = incident.diagnosis?.cause ?? "Unknown";
      counts[cause] = (counts[cause] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([cause, count]) => ({ cause, count }))
      .sort((a, b) => b.count - a.count);
  }

  return { getIncidents: read, recordIncident: record, summarize };
}

const defaultStore = createIncidentStore();
export const getIncidents = () => defaultStore.getIncidents();
export const recordIncident = incident => defaultStore.recordIncident(incident);
export const summarizeIncidents = () => defaultStore.summarize();
