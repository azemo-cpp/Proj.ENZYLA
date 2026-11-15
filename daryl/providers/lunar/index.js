import LunarAI from "./engine.js";
import { makeContext, SITES } from "./planner.js";
import { OLLAMA } from "../ollama.config.js"; // OLLAMA PLACEHOLDER settings
import { createOllamaProvider } from "../ollama.js";
import { SITES_ERROR } from "../../database/sites.js";

/* Wraps Daryl so the diagnostic pipeline can call run(task, signal).
 settings: { siteA, siteB, startMs, days, mask, history, generate, llmTimeoutMs }
 generate(prompt, signal) ay para sa language model. Kapag wala, Ollama ang gagamitin kung naka-on sa ollama.config.js. */
function ollamaGenerate() {
  const model = createOllamaProvider({
    url: OLLAMA.url,
    model: OLLAMA.daryl.model,
    options: { num_predict: OLLAMA.daryl.maxTokens }
  });
  return (prompt, signal) => model.run(prompt, signal);
}

export function createDarylProvider(settings = {}) {
  if (SITES.length === 0) {
    // walang nabasang sites, sasabihin kung bakit
    throw Object.assign(new Error(SITES_ERROR ?? "The site list is empty."), { code: "NO_DATA" });
  }

  const ctx = makeContext(settings);

  if (!SITES[ctx.current[0]] || !SITES[ctx.current[1]]) {
    throw new Error(`Site numbers must be between 0 and ${SITES.length - 1}.`);
  }

  const generate = settings.generate ?? (OLLAMA.daryl.enabled ? ollamaGenerate() : undefined);

  return {
    name: "Daryl",
    settings: ctx,
    async run(task, signal) {
      if (signal?.aborted) throw new Error("Timeout: task was aborted");
      return LunarAI.ask(task, makeContext(settings), {
        generate,
        history: settings.history,
        timeoutMs: settings.llmTimeoutMs ?? OLLAMA.daryl.timeoutMs
      });
    }
  };
}

export { SITES };
