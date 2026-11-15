/* Dito galing ang site data ni Daryl: ang lroc-sites.ts sa folder na ito (o ang file sa DARYL_SITES_FILE).
I-restart si Daryl pagkatapos mong baguhin ang file.
Para gumamit ng ibang file, i-set ang DARYL_SITES_FILE. Format ng bawat site: [name, latitude, longitude, description]. */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadSites } from "./load-sites.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/* Ang LROC sites na kasama sa Daryl (lroc-sites.ts) ang tanging default. Walang paghahanap sa ibang folder.
Para gumamit ng ibang listahan, itakda ang DARYL_SITES_FILE sa path ng file (dapat may export na APOLLO_SITES). */
function findSitesFile() {
  if (process.env.DARYL_SITES_FILE) return path.resolve(process.env.DARYL_SITES_FILE);
  return path.resolve(here, "lroc-sites.ts");
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
