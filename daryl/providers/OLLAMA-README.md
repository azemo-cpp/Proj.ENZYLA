# Ollama placeholder

`ollama.config.js` is the one place to set up the free local AI.

- `doctorModel`: the model the doctor uses (`npm run doctor`).
- `daryl.enabled` / `daryl.model`: lets a model help Daryl with questions its
  engine doesn't recognise. Off by default.
- `ollama.js` is the adapter that talks to Ollama. You normally don't edit it.
