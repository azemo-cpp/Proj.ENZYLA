# Daryl

A lunar mission assistant that lives inside Project Enzyla, in this `daryl/` folder. You ask in plain English,
for example "Compare Apollo 11 and Apollo 17 for 10 days", and he answers from his own Sun and Earth model:
how much of the time a site is sunlit (power), how much Earth is in view (radio contact), the longest darkness,
and the longest communication outage.

Around him is a safety system. Every answer is checked, failures are diagnosed and logged, and an optional
free AI (Ollama) can read the log and propose fixes. Proposed fixes are tested on a copy first, and a human
has to approve them. Daryl himself is a rule-based calculator, not a chat AI, and his numbers are approximate:
good for comparing sites, not for real mission planning.

## Run it

From the main project folder (the one with `package.json`), not from this folder:

    npm run dev          the app and Daryl together (Daryl runs at http://localhost:8787)
    npm run daryl        only Daryl's server
    npm run test:daryl   all of Daryl's tests

On Windows PowerShell use `npm.cmd` instead of `npm`. Needs Node.js 18 or newer (22.8+ for the sandbox).
Daryl has no packages of his own to install.

## Where his data comes from

The sites are read straight from `src/data/apolloSites.ts` when Daryl starts, so there is no copy to keep in sync.
Restart after changing that file. Details in [database/README.md](database/README.md).

## Add a language model (optional)

Daryl works without one. With a model switched on, it answers the questions he doesn't recognise, using only
his own facts (the numbers for every site) and the last few messages, so follow-ups like "what about the other
one?" can work. Questions he already understands stay exact and never go to the model. If the model is slow,
fails, or mentions a number that isn't in the facts, Daryl gives his own answer instead.

Free and on your own computer, with Ollama:

1. Install Ollama from ollama.com, then run `ollama pull llama3.2:3b`.
2. In `providers/ollama.config.js`, set `daryl.enabled` to `true` (change `model` if you pulled a different one).
3. Restart `npm run dev`.

Another model (OpenAI, Gemini, Claude...): give Daryl a `generate(prompt, signal)` function that returns text.
See `createDarylProvider` in `providers/lunar/index.js`. Visitors' questions would go to that company, so keep
API keys in environment variables, never in the code.

## What's inside

| Folder | What it is |
|---|---|
| `providers/lunar/` | Daryl himself: the engine (questions and answers) and the planner (the calculations) |
| `database/` | Reads the site list from `src/data/apolloSites.ts` |
| `protected/` | The pipeline every question goes through |
| `diagnostics/`, `agents/` | The checks, the failure diagnosis, and the incident log |
| `doctor/`, `doctor.js` | The Ollama doctor that proposes fixes (never edits anything) |
| `sandbox.js`, `doctor/sandbox.js` | Tests a proposed fix on a copy of the project |
| `server/`, `server.js` | The web API |
| `public/` | A demo page and a plain-script widget (the app uses `src/components/darylChat.tsx` instead) |

## Before putting it online

- Daryl's server must run somewhere that stays on (a host that runs Node). A file-only host can serve the app
  but not Daryl. The host needs this `daryl/` folder and `src/data/apolloSites.ts`.
- Use HTTPS, and set `ALLOWED_ORIGINS` to your website. The server has no logins, only a rate limit.
- `memory/incidents.json` holds what visitors typed. Keep it private (it's in `.gitignore`).
