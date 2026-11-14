/* OLLAMA PLACEHOLDER: settings ng free local AI.
Ollama runs models on your own computer, no API key needed. Hindi ito gagana hangga't
hindi pa installed at running ang Ollama. To get a model: ollama pull <model name> */

export const OLLAMA = {
  // Default address ng Ollama.
  url: "http://localhost:11434",

  // Doctor: reads incidents and proposes fixes (npm run doctor). Coding model works best.
  doctorModel: "gemma4:12b",

  /* Daryl's chat: lets a model answer questions the engine doesn't recognise (gamit lang ang facts ni Daryl).
  OFF by default, so Daryl answers on his own. Set enabled to true and pick a model you've pulled to try it.
  timeoutMs: gaano katagal maghihintay sa model bago ibalik ang sariling sagot ni Daryl. */
  daryl: {
    enabled: false,
    model: "llama3.1:8b",
    timeoutMs: 30000
  }
};
