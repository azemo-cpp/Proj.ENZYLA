# Daryl

Daryl is a lunar mission assistant. Ask him things like "Compare Apollo 11 and Apollo 17 for 10 days" and he
tells you how much sunlight a site gets, how often Earth is in view for radio contact, and how long the worst
dark stretches are. His numbers are good for comparing sites, not for real mission planning.

Every answer is checked automatically. If something goes wrong, it gets logged, and an optional AI (Ollama)
can look at the log and suggest a fix — but it never changes anything without your approval.

## Run it

From the main project folder (not this folder):

    npm run dev          starts the app and Daryl together (Daryl runs at http://localhost:8787)
    npm run daryl        starts only Daryl
    npm run test:daryl   runs Daryl's tests

On Windows use `npm.cmd` instead of `npm`. Needs Node.js 18 or newer.

## Ollama

By default Daryl answers lunar questions on his own. If you connect a local AI model through Ollama, he can
also handle anything else — jokes, general questions, follow-ups. If Ollama isn't installed or something goes
wrong, Daryl just answers on his own as usual.

### Mac or Linux

1. Install Ollama from https://ollama.com.
2. Run `ollama pull llama3.2:3b`.
3. In `providers/ollama.config.js` set `daryl.enabled` to `true`.
4. Restart.

### Windows

On some Windows machines Ollama crashes when it tries to use the GPU. The fix is to tell it to use the CPU
instead — do this **before** installing Ollama.

1. Press **Win + R**, type `sysdm.cpl`, hit Enter.
2. Go to **Advanced → Environment Variables**.
3. Under **User variables** click **New** and add:
   - Name: `OLLAMA_VULKAN`
   - Value: `false`
4. Click OK, then install Ollama from https://ollama.com/download.
5. Run `ollama pull llama3.2:3b`.
6. In `providers/ollama.config.js` set `daryl.enabled` to `true`.
7. Restart.

> Already installed and it's crashing? Set `OLLAMA_VULKAN=false` as above, then right-click the Ollama icon
> in the system tray and restart it.

## Run the doctor

The doctor looks at the error log and asks an AI model to suggest a fix. It never touches your code — it
only saves a suggestion that you can read and test first.

**One-time setup:** pull the model (about 8 GB — skip this if you're low on space and use `llama3.1:8b` instead):

    ollama pull gemma4:12b

To use `llama3.1:8b` instead, change `doctorModel` in `providers/ollama.config.js` and run `ollama pull llama3.1:8b`.

**Run it** from the `daryl/` folder:

    node doctor.js

The suggestion is saved to `proposals/`. To test it without touching your real files:

    node sandbox.js proposals/<the file it saved>

## What's inside

| Folder | What it does |
|---|---|
| `providers/lunar/` | Daryl's brain — the questions, answers and calculations |
| `database/` | Loads the site list from `database/lroc-sites.ts` |
| `protected/` | Every question passes through here before being answered |
| `diagnostics/`, `agents/` | Checks answers, logs errors |
| `doctor/`, `doctor.js` | The AI that suggests fixes |
| `sandbox.js` | Tests a suggestion on a copy so your files stay safe |
| `server/`, `server.js` | The web server |
| `public/` | The demo page at http://localhost:8787 |

