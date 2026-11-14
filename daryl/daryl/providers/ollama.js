// Free local AI through Ollama, no API key needed. Default address and model come from ollama.config.js.
import { OLLAMA } from "./ollama.config.js";

export function createOllamaProvider({
  url = OLLAMA.url,
  model = OLLAMA.doctorModel,
  system
} = {}) {
  return {
    name: `Ollama (${model})`,
    async run(task, signal) {
      let response;
      try {
        response = await fetch(`${url}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: task, system, stream: false }),
          signal
        });
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
