import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApp } from "../server/app.js";
import { createIncidentStore } from "../diagnostics/learning.js";
import { SITES } from "../database/sites.js";

const quiet = { error() {} };

async function start(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "srv-"));
  const store = createIncidentStore(path.join(dir, "incidents.json"));
  const server = createApp({ store, log: quiet, ...options });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, store };
}

const post = (base, body, headers = {}) =>
  fetch(`${base}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });

test("health check works", async t => {
  const { base } = await start(t);
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.name, "Daryl");
  assert.equal(body.ready, SITES.length > 0);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("the sites list comes from the site data", async t => {
  const { base } = await start(t);
  const body = await (await fetch(`${base}/api/sites`)).json();
  assert.equal(body.sites.length, SITES.length);
  assert.deepEqual(body.sites[0], {
    index: 0, name: SITES[0][0], latitude: SITES[0][1], longitude: SITES[0][2]
  });
});

test("a question gets an answer through the pipeline", async t => {
  const { base, store } = await start(t);
  const res = await post(base, { question: "Write a mission briefing", settings: { siteA: 0, siteB: 1, days: 10, date: "2026-11-01" } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, "SUCCESS");
  assert.ok(body.answer.includes(SITES[0][0]));
  assert.match(body.requestId, /^[0-9a-f]{8}$/);
  assert.equal((await store.getIncidents()).length, 0);
});

test("bad requests get clear 4xx answers", async t => {
  const { base } = await start(t);
  const cases = [
    [{ }, 400, /question/],
    [{ question: "   " }, 400, /question/],
    [{ question: 42 }, 400, /question/],
    [{ question: "x".repeat(2001) }, 400, /too long/],
    [{ question: "hi", settings: "nope" }, 400, /settings/],
    [{ question: "hi", settings: { hack: 1 } }, 400, /Unknown setting/],
    [{ question: "hi", settings: { siteA: 999 } }, 400, /siteA/],
    [{ question: "hi", settings: { siteA: "0" } }, 400, /siteA/],
    [{ question: "hi", settings: { days: 1 } }, 400, /days/],
    [{ question: "hi", settings: { mask: 99 } }, 400, /mask/],
    [{ question: "hi", settings: { date: "2026-13-45" } }, 400, /date/],
    [{ question: "hi", settings: { date: "tomorrow" } }, 400, /date/]
  ];
  for (const [body, status, message] of cases) {
    const res = await post(base, body);
    assert.equal(res.status, status, JSON.stringify(body).slice(0, 60));
    assert.match((await res.json()).message, message);
  }
});

test("bad JSON, wrong content type, and huge bodies are refused", async t => {
  const { base } = await start(t);
  assert.equal((await post(base, "{not json")).status, 400);

  const wrongType = await fetch(`${base}/api/ask`, {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: '{"question":"hi"}'
  });
  assert.equal(wrongType.status, 415);

  const huge = await post(base, { question: "hi", padding: "x".repeat(30 * 1024) });
  assert.equal(huge.status, 413);
});

test("too many requests get a 429 with Retry-After", async t => {
  const { base } = await start(t, { rateLimit: { max: 3, windowMs: 60000 } });
  for (let i = 0; i < 3; i++) assert.equal((await post(base, { question: "hi" })).status, 200);
  const res = await post(base, { question: "hi" });
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) >= 1);
  assert.equal((await fetch(`${base}/api/health`)).status, 200); // health is exempt
});

test("failures don't leak internals, but are recorded", async t => {
  const providerFactory = () => ({
    run: async () => { throw new Error("connect ECONNREFUSED secret-host:5432"); }
  });
  const { base, store } = await start(t, { providerFactory });
  const res = await post(base, { question: "hi" });
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.ok(!text.includes("secret-host"));
  assert.ok(!text.includes("repairPlan"));
  assert.ok(!text.includes("ECONNREFUSED"));
  assert.equal(JSON.parse(text).status, "ERROR");
  assert.equal((await store.getIncidents()).length, 1);
});

test("a slow provider becomes a 504 timeout", async t => {
  const providerFactory = () => ({ run: () => new Promise(() => {}) });
  const { base } = await start(t, { providerFactory, timeoutMs: 80 });
  const res = await post(base, { question: "hi" });
  assert.equal(res.status, 504);
  assert.equal((await res.json()).status, "TIMEOUT");
});

test("a provider that can't be created gives a 400, not a crash", async t => {
  const providerFactory = () => { throw new Error("Site numbers must be between 0 and 6."); };
  const { base } = await start(t, { providerFactory });
  const res = await post(base, { question: "hi" });
  assert.equal(res.status, 400);
});

test("CORS: allowed sites work, others are refused", async t => {
  const { base } = await start(t, { allowedOrigins: ["https://mysite.example"] });

  const ok = await post(base, { question: "hi" }, { Origin: "https://mysite.example" });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://mysite.example");

  const preflight = await fetch(`${base}/api/ask`, {
    method: "OPTIONS", headers: { Origin: "https://mysite.example", "Access-Control-Request-Method": "POST" }
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-headers"), /Content-Type/);

  const bad = await post(base, { question: "hi" }, { Origin: "https://evil.example" });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get("access-control-allow-origin"), null);

  const same = await post(base, { question: "hi" }, { Origin: base });
  assert.equal(same.status, 200);
});

test("CORS: a pattern like localhost:any-port can be allowed", async t => {
  const { base } = await start(t, { allowedOrigins: [/^http:\/\/localhost(:\d+)?$/] });
  for (const origin of ["http://localhost:5173", "http://localhost"]) {
    const res = await post(base, { question: "hi" }, { Origin: origin });
    assert.equal(res.status, 200, origin);
    assert.equal(res.headers.get("access-control-allow-origin"), origin);
  }
  for (const origin of ["http://localhost.evil.com", "https://localhost:5173", "http://evil.com"]) {
    assert.equal((await post(base, { question: "hi" }, { Origin: origin })).status, 403, origin);
  }
});

test("unknown paths are 404 and wrong methods are 405", async t => {
  const { base } = await start(t);
  assert.equal((await fetch(`${base}/nothing`)).status, 404);
  assert.equal((await fetch(`${base}/api/nothing`)).status, 404);
  const wrong = await fetch(`${base}/api/ask`);
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get("allow"), "POST");
});

test("only the demo files are served", async t => {
  const { base } = await start(t);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
  assert.match(await page.text(), /Daryl/);

  const widget = await fetch(`${base}/daryl-widget.js`);
  assert.match(widget.headers.get("content-type"), /javascript/);

  for (const bad of ["/package.json", "/../package.json", "/%2e%2e/package.json", "/memory/incidents.json", "/server.js"]) {
    assert.equal((await fetch(`${base}${bad}`)).status, 404, bad);
  }
});

test("no site data gives a 503, not a crash", async t => {
  const providerFactory = () => {
    throw Object.assign(new Error("No site data yet."), { code: "NO_DATA" });
  };
  const { base } = await start(t, { providerFactory });
  const res = await post(base, { question: "hi" });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, "NO_DATA");
  assert.ok(!body.message.includes("sites.js")); // walang internal details sa bisita
});

/* Kapag sinimulan ng Vite si Daryl, dapat siyang tumigil pag nawala ang Vite. (Skip sa loob ng sandbox: bawal doon ang mag-spawn.) */
const canSpawn = process.permission ? process.permission.has("child") : true;

test("the server starts, prints its real port, and stops when its parent goes away", { skip: !canSpawn }, async () => {
  const { spawn } = await import("node:child_process");
  const entry = new URL("../server.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "inherit", "ipc"]
  });

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 8000);
    child.stdout.on("data", chunk => {
      const m = String(chunk).match(/localhost:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.on("exit", () => reject(new Error("server exited early")));
  });

  assert.ok(port > 0);
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.status, 200);

  /* Default ng server.js: ang localhost websites (gaya ng Vite dev server) ay pwede, ang iba ay hindi. */
  const local = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Origin: "http://localhost:5173" } });
  assert.equal(local.status, 200);
  assert.equal(local.headers.get("access-control-allow-origin"), "http://localhost:5173");
  const stranger = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { Origin: "https://evil.example" } });
  assert.equal(stranger.status, 403);

  const exited = new Promise(resolve => child.on("exit", code => resolve(code)));
  child.disconnect(); // gaya ng pagkawala ng parent
  const code = await Promise.race([exited, new Promise(r => setTimeout(() => r("still running"), 6000))]);
  if (code === "still running") child.kill();
  assert.equal(code, 0);
});

test("history is checked and passed on to the provider", async t => {
  let seen = null;
  const providerFactory = settings => { seen = settings; return { run: async () => "ok" }; };
  const { base } = await start(t, { providerFactory });

  const good = await post(base, {
    question: "and the other one?",
    settings: { siteA: 0 },
    history: [{ role: "user", text: "tell me about the first" }, { role: "daryl", text: "It is..." }]
  });
  assert.equal(good.status, 200);
  assert.equal(seen.siteA, 0);
  assert.deepEqual(seen.history, [{ role: "user", text: "tell me about the first" }, { role: "daryl", text: "It is..." }]);

  await post(base, { question: "hi" });
  assert.deepEqual(seen.history, []); // walang history = walang laman
});

test("bad history is refused", async t => {
  const { base } = await start(t);
  const many = Array.from({ length: 9 }, () => ({ role: "user", text: "x" }));
  const cases = [
    "nope", many, [null], [{ role: "admin", text: "x" }], [{ role: "user", text: 5 }],
    [{ role: "user", text: "x".repeat(1501) }], [{ text: "no role" }]
  ];
  for (const history of cases) {
    const res = await post(base, { question: "hi", history });
    assert.equal(res.status, 400, JSON.stringify(history).slice(0, 50));
    assert.match((await res.json()).message, /history/i);
  }
});
