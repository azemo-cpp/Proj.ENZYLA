/* Binabasa ang listahan ng sites mula sa apolloSites.ts ng Enzyla.
Una, diretso ang import ng .ts file (kaya ito ng Node 22.18 pataas). Kung hindi kaya ng Node mo,
binabasa na lang ang text ng file (parse-apollo.js). Pareho ang resulta. */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { parseApolloSites } from "./parse-apollo.js";

function fromModule(mod) {
  const list = mod.APOLLO_SITES;
  if (!Array.isArray(list) || list.length === 0) throw new Error("APOLLO_SITES is missing or empty.");

  return list.map((s, i) => {
    const ok =
      s && typeof s.name === "string" && s.name &&
      Number.isFinite(s.lat) && s.lat >= -90 && s.lat <= 90 &&
      Number.isFinite(s.lon) && s.lon >= -180 && s.lon <= 180;
    if (!ok) throw new Error(`site #${i + 1} needs a name, a lat from -90 to 90 and a lon from -180 to 180.`);

    const site = [s.name, s.lat, s.lon];
    if (typeof s.description === "string") site.push(s.description);
    return site;
  });
}

export async function loadSites(file, { useImport = true } = {}) {
  if (useImport) {
    try {
      return fromModule(await import(pathToFileURL(file).href));
    } catch {
      /* hindi kaya ng Node na ito ang .ts, o may import sa loob ng file. Subukan ang text reader. */
    }
  }
  return parseApolloSites(await readFile(file, "utf8"));
}
