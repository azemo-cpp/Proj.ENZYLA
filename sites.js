/* Dito galing ang site data ni Daryl: diretso sa src/data/apolloSites.ts ng Enzyla app.
Walang kopya, kaya walang sync. I-restart si Daryl pagkatapos mong baguhin ang apolloSites.ts.
Para gumamit ng ibang file, i-set ang DARYL_SITES_FILE. Format ng bawat site: [name, latitude, longitude, description]. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadSites } from "./load-sites.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/* Hinahanap ang apolloSites.ts sa ilang lugar paakyat sa mga folder, para gumana kahit may dagdag na folder
(hal. project/daryl-fixed/daryl). Ang DARYL_SITES_FILE ay palaging nauuna. */
function findSitesFile() {
  if (process.env.DARYL_SITES_FILE) return path.resolve(process.env.DARYL_SITES_FILE);
  const candidates = [2, 3, 4].map(up => path.resolve(here, ...Array(up).fill(".."), "src/data/apolloSites.ts"));
  return candidates.find(f => fs.existsSync(f)) ?? candidates[0];
}

export const SITES_FILE = findSitesFile();

let sites = [];
let error = null;
try {
  sites = await loadSites(SITES_FILE);
} catch (e) {
  // hindi tumitigil ang buong Daryl: walang laman ang listahan, at sinasabi kung bakit
  error = `Couldn't read the sites from ${SITES_FILE}: ${e.message}`;
}

export const SITES = sites;
export const SITES_ERROR = error;
