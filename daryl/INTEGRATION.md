# Daryl inside Project Enzyla

Daryl lives in this `daryl/` folder. The chat box (bottom-right) is `src/components/darylChat.tsx`,
shown from `src/app.tsx`.

## Run it

One command, from the main project folder:

    npm.cmd run dev

That starts the app (http://localhost:5173) and Daryl's server (port 8787) together, and stops both when you
press Ctrl+C. If the app is closed in any other way, Daryl stops by himself too.

- **Run Daryl by itself:** `npm.cmd run daryl`. Set `DARYL_AUTOSTART=0` so `npm.cmd run dev` doesn't also start him.
- **Another port:** set `DARYL_PORT` (for example `$env:DARYL_PORT="9000"` in PowerShell) before `npm.cmd run dev`.
- **"Can't reach Daryl":** his server isn't running. Look in the terminal for a line starting with `[daryl]`.
  It usually means the port is taken, or Daryl is already running in another terminal.
- If the sites can't be read, the terminal prints `Warning: no sites loaded` and the reason.
- If Daryl is down, the rest of the app works as before.

## How it fits

- **Sites:** read straight from `src/data/apolloSites.ts` when Daryl starts. Restart after changing it.
- **Selected site:** when a site is picked in the app, Daryl uses it as the default, next to the following site
  in the list so there is something to compare. Naming a site in the question always wins.
- **Chat memory:** the chat box sends the last 6 messages. They are only used when a language model is on (see README).
- **Tests:** `npm.cmd run test:daryl`.
- **Going live:** host Daryl's server (HTTPS, see the checklist below) with the `daryl/` folder and
  `src/data/apolloSites.ts` next to each other, build the app with `VITE_DARYL_API=https://your-daryl-server`,
  and set `ALLOWED_ORIGINS=https://your-website` on Daryl's server. If the folders can't sit like that on the
  host, point `DARYL_SITES_FILE` at the sites file.

## Known differences

- The numbers Daryl calculates come from his own simplified Sun and Earth model. The numbers in the
  Site Conditions panel (`siteTimeline.tsx`) are typed in by hand, so the two will not match.
- Daryl answers about the next 14 days from today, while the panel describes conditions at each landing.

---

# Daryl on any website

# Adding Daryl to a website

Daryl runs as a small web server. Your website's page talks to it, and every
question still goes through the pipeline (checks, diagnosis, incident log).

## Try it on your computer

    npm.cmd start

Then open http://localhost:8787. The demo page shows Daryl in a box, parang sa
designated place sa totoong website.

## Put Daryl on a page

Panel inside a box (the box decides the size):

    <div id="daryl-box" style="height: 520px"></div>
    <script src="https://YOUR-DARYL-SERVER/daryl-widget.js"></script>
    <script>
      Daryl.mount("#daryl-box", { settings: { siteA: 0, siteB: 1, days: 10 } });
    </script>

Floating bubble in the corner:

    <script src="https://YOUR-DARYL-SERVER/daryl-widget.js"></script>
    <script>Daryl.mount(null, { mode: "bubble" });</script>

Options for `Daryl.mount(target, options)`:

| Option | Default | Meaning |
|---|---|---|
| `mode` | `"panel"` | `"panel"` fills the target box, `"bubble"` floats bottom-right |
| `api` | the server the script came from | Base URL of the Daryl server |
| `title` | `"Daryl"` | Name shown in the header and on the bubble |
| `placeholder` | `"Ask about a site or date"` | Hint inside the text box |
| `greeting` | a short hello | First message ("" for none) |
| `settings` | none | Sites, days, date and mask to use (see below) |

It returns `{ open(), close(), destroy() }`.

Colours and font follow CSS variables on the page, so match your brand:

    [data-daryl] { --daryl-accent: #0b7a75; --daryl-radius: 8px; }

Others: `--daryl-bg`, `--daryl-fg`, `--daryl-muted`, `--daryl-border`, `--daryl-font`.
Dark mode follows the visitor's system setting.

## The API

All answers are JSON.

| Method and path | What it does |
|---|---|
| `GET /api/health` | `{ ok, name, version }`, for monitoring (not rate limited) |
| `GET /api/sites` | `{ ok, sites: [{ index, name, latitude, longitude }] }` |
| `POST /api/ask` | Ask a question |

`POST /api/ask` needs `Content-Type: application/json`:

    { "question": "Compare the two sites",
      "settings": { "siteA": 0, "siteB": 1, "days": 10, "date": "2026-11-01", "mask": 1 } }

`settings` is optional, and so is every key in it. `siteA` and `siteB` are site
numbers from `/api/sites`, `days` is 2 to 60, `date` is `YYYY-MM-DD`, `mask` is 0 to 10.
Unknown keys are refused.

`history` is optional too: up to 8 recent messages, each `{ "role": "user" or "daryl", "text": "..." }` with text
under 1500 characters. It is only used when a language model is switched on (see the README), so a follow-up like
"what about the other one?" makes sense. The React chat box sends the last 6 messages by itself.

Success: `{ "ok": true, "status": "SUCCESS", "answer": "...", "durationMs": 4, "requestId": "a1b2c3d4" }`.
The answer is plain text with simple `| table |` rows, which the widget draws as real tables.

Failure: `{ "ok": false, "status": "...", "message": "...", "requestId": "..." }`

| HTTP | status | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Something in the request is wrong (the message says what) |
| 403 | `ORIGIN_NOT_ALLOWED` | The website isn't on the allowed list |
| 413 / 415 | `BAD_REQUEST` | Body too large (20 KB max) / not JSON |
| 429 | `RATE_LIMITED` | Too many requests (30 a minute per visitor). See `Retry-After` |
| 502 | `ERROR` | Daryl failed. Details are in the server log and `memory/incidents.json`, not sent to visitors |
| 504 | `TIMEOUT` | Took longer than 15 seconds |

## Settings for the server (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port to listen on |
| `HOST` | `127.0.0.1` | Only this computer can connect. Use `0.0.0.0` to allow others |
| `ALLOWED_ORIGINS` | none (websites on localhost are allowed while `HOST` is the default) | Websites allowed to call the API from a browser, comma separated, e.g. `https://mysite.com` |
| `TRUST_PROXY` | off | Set to `1` only behind your own proxy, so rate limits use the visitor's real address |

PowerShell example:

    $env:ALLOWED_ORIGINS = "https://mysite.com"; npm.cmd start

If the page and the server are on the same address (like the demo), no
`ALLOWED_ORIGINS` is needed.

## Before going live

- **Use HTTPS.** Put the server behind a proxy that does it (Caddy, nginx, or your host's own).
- **Set `ALLOWED_ORIGINS`** to your real site, never leave it open to everyone.
- **The server has no logins.** Anyone who can reach it can ask questions, so keep the rate limit on.
- **The sites come from your app's `apolloSites.ts`.** Replace them with your real data before real use (see `database/README.md`).
- **`memory/incidents.json` will hold what visitors typed.** Keep it private and out of GitHub.
- **Only `server.js` and `/server` face the internet.** Never expose `doctor.js` or `sandbox.js`.
- **The rate limit and incident log are per server.** If you run several copies, they don't share.
