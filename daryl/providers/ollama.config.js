/* OLLAMA PLACEHOLDER: settings ng free local AI.
Ollama runs models on your own computer, no API key needed. Hindi ito gagana hangga't
hindi pa installed at running ang Ollama. To get a model: ollama pull <model name>

WINDOWS: set OLLAMA_VULKAN=false as a user environment variable before installing Ollama,
otherwise it may crash on AMD or older GPUs. See README.md for step-by-step instructions. */

export const OLLAMA = {
  // Gaano katagal nananatili ang model sa memory pagkatapos ng huling tanong (para hindi mabagal ang susunod).
  keepAlive: "24h",

  // Default address ng Ollama.
  url: "http://localhost:11434",

  // Doctor: reads incidents and proposes fixes (node doctor.js). Coding model works best.
  // Pull it with: ollama pull gemma4:12b
  // Smaller alternative: llama3.1:8b
  doctorModel: "gemma4:12b",

  /* Daryl's chat: lets a model answer questions the engine doesn't recognise.
  enabled: true  — uses Ollama if running; falls back to Daryl's own answers if not installed or unreachable.
                   Safe to leave as true on any machine.
  enabled: false — Daryl always answers on his own, Ollama is never called.
  Pull the model with: ollama pull llama3.2:3b
  timeoutMs: how long to wait for the model before falling back to Daryl's own answer. */
  daryl: {
    enabled: true,
    model: "llama3.2:3b",
    maxTokens: 250,
    timeoutMs: 60000
  }
};
