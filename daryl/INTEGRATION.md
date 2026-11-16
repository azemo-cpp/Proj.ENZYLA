# Daryl inside Project Enzyla

Daryl lives in the `daryl/` folder. The chat box in the bottom-right corner of the app is
`src/components/DarylChat.tsx`, loaded from `src/App.tsx`.

## Run it

From the main project folder:

    npm.cmd run dev

This starts the app at http://localhost:5173 and Daryl at http://localhost:8787 at the same time.
Both stop when you press Ctrl+C.

A few other options:

- **Daryl only:** `npm.cmd run daryl`. Add `DARYL_AUTOSTART=0` if you don't want `npm.cmd run dev` to also start him.
- **Different port:** set `DARYL_PORT` before running, e.g. `$env:DARYL_PORT="9000"` in PowerShell.
- **"Can't reach Daryl":** his server isn't running. Check the terminal for a line starting with `[daryl]` — it usually means the port is already in use or Daryl is open in another window.

## How things connect

- **Sites:** Daryl reads the site list from `database/lroc-sites.ts` on startup. Restart after editing it. Set `DARYL_SITES_FILE` to use another supported site-list file.
- **Selected site:** when you pick a site in the app, Daryl uses it as his default. Naming a site in a question always takes priority.
- **Chat history:** the chat box sends the last 6 messages so Daryl can handle follow-ups like "what about the other one?" (only works when a language model is connected — see README).
- **Tests:** `npm.cmd run test:daryl`.

## Add Daryl to any website

Daryl runs as a small web server. Any page can talk to it by adding a small script tag.

**Try it locally first:**

    npm.cmd start

Then open http://localhost:8787 to see the demo.

**Add it to a page — in a box:**

    <div id="daryl-box" style="height: 520px"></div>
    <script src="https://YOUR-DARYL-SERVER/daryl-widget.js"></script>
    <script>
      Daryl.mount("#daryl-box", { settings: { siteA: 0, siteB: 1, days: 10 } });
    </script>

**Add it as a floating bubble in the corner:**

    <script src="https://YOUR-DARYL-SERVER/daryl-widget.js"></script>
    <script>Daryl.mount(null, { mode: "bubble" });</script>

**Options for `Daryl.mount(target, options)`:**

| Option | Default | What it does |
|---|---|---|
| `mode` | `"panel"` | `"panel"` fills the target box, `"bubble"` floats in the corner |
| `api` | same server the script came from | Address of the Daryl server |
| `title` | `"Daryl"` | Name shown in the header |
| `placeholder` | `"Ask about a site or date"` | Hint text inside the chat box |
| `greeting` | a short hello | First message Daryl sends (`""` for none) |
| `settings` | none | Sites, days, date and terrain setting (see below) |

Returns `{ open(), close(), destroy() }` so you can control it from your own code.

**Match your site's colours** using CSS variables:

    [data-daryl] { --daryl-accent: #0b7a75; --daryl-radius: 8px; }

Others: `--daryl-bg`, `--daryl-fg`, `--daryl-muted`, `--daryl-border`, `--daryl-font`. Dark mode follows the visitor's system setting automatically.

## API endpoints

| Method | Path | What it returns |
|---|---|---|
| `GET` | `/api/health` | `{ ok, name, version }` — good for uptime checks |
| `GET` | `/api/sites` | The list of sites with index, name and coordinates |
| `POST` | `/api/ask` | Ask Daryl a question |

**Asking a question** (`POST /api/ask`, send as JSON):

    {
      "question": "Compare the two sites",
      "settings": { "siteA": 0, "siteB": 1, "days": 10, "date": "2026-11-01", "mask": 1 }
    }

`settings` is optional. `siteA` and `siteB` are site numbers from `/api/sites`. `days` is 2–60.
`date` is `YYYY-MM-DD`. `mask` is terrain height in degrees (0–10). Unknown keys are rejected.

You can also include `history` — up to 8 recent messages so Daryl can handle follow-ups:

    "history": [
      { "role": "user", "text": "How is Apollo 11?" },
      { "role": "daryl", "text": "Apollo 11 is sunlit 80% of the time..." }
    ]

**Success response:**

    { "ok": true, "status": "SUCCESS", "answer": "...", "durationMs": 4, "requestId": "a1b2c3d4" }

**Error responses:**

| HTTP | What happened |
|---|---|
| 400 | Something in the request is wrong (the message explains what) |
| 403 | This website isn't allowed to call the API |
| 429 | Too many requests — wait a moment and try again |
| 502 | Daryl hit an error. Details are in the server log, not sent to the page |
| 504 | Took too long to answer |

## Known differences

- Daryl's calculations use his own simplified model. The numbers in the Site Conditions panel (`SiteTimeline.tsx`) are entered by hand, so they won't match exactly.
- Daryl answers about the next 14 days from today. The panel describes fixed conditions per site.
