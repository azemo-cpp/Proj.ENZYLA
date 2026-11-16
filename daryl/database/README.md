# Daryl database

- `lroc-sites.ts` is the default site list. `sites.js` loads it and exposes `SITES`, `SITES_FILE`, and `SITES_ERROR`. Set `DARYL_SITES_FILE` to load a different file.
- `load-sites.js` loads the site data; `parse-apollo.js` reads the TypeScript data format when the Node version cannot import it directly.
- The lunar planner puts `SITES` in the AI context. Daryl uses each site's name, coordinates, and optional description when answering site questions.
- `build-thermal.js` reads Diviner level 4 `.xyz` files and generates `site-thermal.json`. The AI does not currently load that generated thermal file.

To regenerate the thermal file from a folder containing `diviner_tbol_max.xyz` and `diviner_tbol_min.xyz`, run:

```powershell
node database/build-thermal.js "C:\path\to\diviner-files"
```
