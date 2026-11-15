// Free local AI through Ollama, no API key needed. Default address and model come from ollama.config.js.
import { OLLAMA } from "./ollama.config.js";

/* Ang "-1" na text ay tinatanggihan ng Ollama (error 400); kailangan itong numero. Ang "30m", "24h" ay okay. */
function normalizeKeepAlive(v) {
  if (typeof v === "string" && /^\s*-?\d+\s*$/.test(v)) return Number(v);
  return v;
}

export function createOllamaProvider({
  url = OLLAMA.url,
  model = OLLAMA.doctorModel,
  system,
  options,
  keepAlive = OLLAMA.keepAlive
} = {}) {
  return {
    name: `Ollama (${model})`,
    async run(task, signal) {
      const post = (body) =>
        fetch(`${url}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal
        });
      const full = { model, prompt: task, system, stream: false, keep_alive: normalizeKeepAlive(keepAlive), options };

      let response;
      try {
        response = await post(full);
        // Kapag tinanggihan ang dagdag na settings (keep_alive/options), subukan ulit na payak, para hindi pumalya ang sagot.
        if (response.status === 400) {
          console.warn("[DARYL OLLAMA] Ollama rejected the extra settings (error 400). Retrying with plain settings.");
          response = await post({ model, prompt: task, system, stream: false });
        }
      } catch (error) {
        if (signal?.aborted) throw new Error("Timeout: request was aborted");
        const code = error.cause?.code ?? "";
        if (code === "ECONNREFUSED" || /fetch failed/i.test(error.message)) {
          throw new Error(
            `connect ECONNREFUSED: cannot reach Ollama at ${url}. Is it running?`
          );
        }
        throw error;
      }

      if (response.status === 404) {
        throw new Error(`Model "${model}" not found. Run: ollama pull ${model}`);
      }
      if (!response.ok) {
        throw new Error(`Ollama returned error ${response.status}`);
      }

      const data = await response.json();
      return typeof data.response === "string" ? data.response : "";
    }
  };
}
