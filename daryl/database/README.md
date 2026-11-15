# database/

Dito galing ang site data ni Daryl.

- Ang default ng `sites.js` ay ang `lroc-sites.ts` (33 LROC site, mga coordinate mula sa NASA NSSDC). Para gumamit ng ibang listahan, itakda ang `DARYL_SITES_FILE` sa file na may export na `APOLLO_SITES`.
  I-restart si Daryl (`npm run dev`) pagkatapos mong baguhin ang file.
- `load-sites.js` ang nagbabasa. Una, diretso ang import ng .ts file (kaya ito ng Node 22.18 pataas).
  Kung hindi kaya ng Node mo, binabasa na lang ang text ng file gamit ang `parse-apollo.js`. Pareho ang resulta.
- Ang kinukuha lang ni Daryl sa bawat site ay `name`, `lat`, `lon` at `description`. Optional ang description.
- Kung hindi mabasa ang file, hindi tumitigil si Daryl: walang laman ang listahan, may babala sa terminal,
  at ang chat ay nagsasabing hindi pa siya handa.
- `DARYL_SITES_FILE` ang pwedeng i-set kung ibang file ang gusto mong gamitin.

Kapag real database na ang gagamitin: palitan ang laman ng `sites.js` ng listahan sa format na
`[name, latitude, longitude, description]`, at burahin ang `load-sites.js` at `parse-apollo.js`.
Huwag maglagay ng database password sa mga file na ito. Gamitin ang `.env` at huwag i-upload sa GitHub.

Ang `memory/incidents.json` ay pwede ring ilipat sa database. Tumatanggap na ng `store` option ang `runDiagnosticCycle`.
