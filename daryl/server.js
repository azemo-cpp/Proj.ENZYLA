/* Starts the Daryl web API at http://localhost:8787. Usage: npm.cmd start
Settings (optional, environment variables): PORT, HOST, ALLOWED_ORIGINS (comma list), TRUST_PROXY=1 */
import { createApp } from "./server/app.js";
import { OLLAMA } from "./providers/ollama.config.js";
import { createOllamaProvider } from "./providers/ollama.js";
import { SITES, SITES_ERROR } from "./database/sites.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1"; // localhost lang, hindi nakikita ng ibang computer
const configured = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

/* Kapag sa sarili mong computer lang naka-bukas si Daryl (default), pwede siyang tawagan
ng mga website sa localhost, halimbawa ang app mo habang dine-develop. Hindi ito bukas sa ibang computer. */
const LOCAL_SITES = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const onlyThisComputer = ["127.0.0.1", "localhost", "::1"].includes(host);
const allowedOrigins = onlyThisComputer ? [...configured, LOCAL_SITES] : configured;

// Mas matagal ang hintay kapag naka-on ang language model (ang model mismo ay may sarili ring limit)
const timeoutMs = OLLAMA.daryl.enabled ? OLLAMA.daryl.timeoutMs + 15000 : 15000;

const server = createApp({ allowedOrigins, timeoutMs, trustProxy: process.env.TRUST_PROXY === "1" });

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Close the other program, or use another port.`);
  } else {
    console.error(error.message);
  }
  process.exit(1);
});

if (SITES.length === 0) console.warn(`Warning: no sites loaded. ${SITES_ERROR ?? ""}`);

server.listen(port, host, () => {
  const shown = server.address().port;
  console.log(`Daryl is running at http://${host === "127.0.0.1" ? "localhost" : host}:${shown}`);
  console.log("Press Ctrl+C to stop.");

  /* Pinapainit ang model habang nag-i-start, para ang unang tanong ay hindi na naghihintay sa pag-load nito. */
  if (OLLAMA.daryl.enabled) {
    const started = Date.now();
    console.log(`Loading the AI model (${OLLAMA.daryl.model})... the first answer may be slow until this finishes.`);
    createOllamaProvider({ url: OLLAMA.url, model: OLLAMA.daryl.model, options: { num_predict: 1 } })
      .run("hi", AbortSignal.timeout(180000))
      .then(() => console.log(`AI model ready (${Math.round((Date.now() - started) / 1000)}s).`))
      .catch(e => console.warn(`AI model not ready: ${e.message}`));
  }
});

function shutdown() {
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 2000).unref(); // fallback kung may nakabitin
}

process.on("SIGINT", () => {
  console.log("\nStopping...");
  shutdown();
});

/* Kapag sinimulan ni Vite si Daryl (may IPC channel), titigil siya kapag nawala si Vite,
kahit biglaan (Ctrl+C, IDE stop, nag-close ang terminal). Para hindi maiwan na tumatakbo. */
if (process.send) process.on("disconnect", shutdown);
