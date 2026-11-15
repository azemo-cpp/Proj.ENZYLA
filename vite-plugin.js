/* Pinapatakbo si Daryl sa loob mismo ng Vite dev server. Isang command (npm run dev), isang port, walang pangalawang server.
   Ang mga request sa /api/* ay diretsong napupunta sa API ni Daryl; ang lahat ng iba ay hawak pa rin ni Vite.
   Ang daryl/server.js ay nandiyan pa rin para sa production o kung gusto mo siyang patakbuhin nang hiwalay. */
import path from "node:path";
import { pathToFileURL } from "node:url";

export default function daryl() {
  return {
    name: "daryl-in-vite",
    apply: "serve", // dev lang. Sa production build, wala ito.

    async configureServer(server) {
      const root = path.resolve(server.config.root, "daryl");
      const load = file => import(pathToFileURL(path.join(root, file)).href);

      let app;
      try {
        const [{ createApp }, { OLLAMA }, { createOllamaProvider }, { SITES, SITES_ERROR }] = await Promise.all([
          load("server/app.js"),
          load("providers/ollama.config.js"),
          load("providers/ollama.js"),
          load("database/sites.js")
        ]);

        // Pareho ng server.js: ang app mo sa localhost ay pinapayagan, walang ibang computer.
        const timeoutMs = OLLAMA.daryl.enabled ? OLLAMA.daryl.timeoutMs + 15000 : 15000;
        app = createApp({ allowedOrigins: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/], timeoutMs });

        if (SITES.length === 0) server.config.logger.warn(`[daryl] no sites loaded. ${SITES_ERROR ?? ""}`);

        // Pinapainit ang language model para hindi mabagal ang unang tanong.
        if (OLLAMA.daryl.enabled) {
          const started = Date.now();
          server.config.logger.info(`[daryl] loading the AI model (${OLLAMA.daryl.model})...`);
          createOllamaProvider({ url: OLLAMA.url, model: OLLAMA.daryl.model, options: { num_predict: 1 } })
            .run("hi", AbortSignal.timeout(180000))
            .then(() => server.config.logger.info(`[daryl] AI model ready (${Math.round((Date.now() - started) / 1000)}s).`))
            .catch(e => server.config.logger.warn(`[daryl] AI model not ready: ${e.message}`));
        }
      } catch (e) {
        // Kapag pumalya si Daryl, tuloy pa rin ang app. Hindi dapat bumagsak ang buong Vite dahil dito.
        server.config.logger.error(`[daryl] could not start: ${e.message}`);
        return;
      }

      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith("/api/")) app.emit("request", req, res);
        else next();
      });
      server.config.logger.info("[daryl] ready inside the dev server (/api/ask, /api/sites)");
    }
  };
}
