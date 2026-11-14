/* Dito galing ang site data ni Daryl: diretso sa src/data/apolloSites.ts ng Enzyla app.
Walang kopya, kaya walang sync. I-restart si Daryl pagkatapos mong baguhin ang apolloSites.ts.
Para gumamit ng ibang file, i-set ang DARYL_SITES_FILE. Format ng bawat site: [name, latitude, longitude, description]. */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadSites } from "./load-sites.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const SITES_FILE = process.env.DARYL_SITES_FILE
  ? path.resolve(process.env.DARYL_SITES_FILE)
  : path.resolve(here, "../../src/data/apolloSites.ts");

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
