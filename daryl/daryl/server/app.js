/* Ang web API ni Daryl. Walang dependencies, Node lang.
Lahat ng tanong ay dumadaan pa rin sa pipeline (protected/run.js). */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runDiagnosticCycle } from "../protected/run.js";
import { createDarylProvider, SITES } from "../providers/lunar/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(here, "../public");
const VERSION = JSON.parse(readFileSync(path.resolve(here, "../package.json"), "utf8")).version;

// Only these files are served. Walang directory listing, kaya walang path tricks.
const STATIC = {
  "/": ["demo.html", "text/html; charset=utf-8"],
  "/demo.html": ["demo.html", "text/html; charset=utf-8"],
  "/demo.js": ["demo.js", "text/javascript; charset=utf-8"],
  "/daryl-widget.js": ["daryl-widget.js", "text/javascript; charset=utf-8"]
};

const PAGE_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'";

const GENERIC_ERROR = "Daryl couldn't answer that right now. Please try again.";

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  res.end(text);
}

// Returns { settings } or { error }. Unknown keys are rejected para hindi mag-silent fail.
function checkSettings(input) {
  if (input === undefined || input === null) return { settings: {} };
  if (typeof input !== "object" || Array.isArray(input)) return { error: "settings must be an object." };

  const known = new Set(["siteA", "siteB", "days", "date", "mask"]);
  for (const key of Object.keys(input)) {
    if (!known.has(key)) return { error: `Unknown setting: ${key}.` };
  }

  const settings = {};
  const int = (name, min, max) => {
    const v = input[name];
    if (v === undefined) return null;
    if (!Number.isInteger(v) || v < min || v > max) return `${name} must be a whole number from ${min} to ${max}.`;
    settings[name] = v;
    return null;
  };

  const problem =
    int("siteA", 0, SITES.length - 1) ||
    int("siteB", 0, SITES.length - 1) ||
    int("days", 2, 60);
  if (problem) return { error: problem };

  if (input.mask !== undefined) {
    if (typeof input.mask !== "number" || !(input.mask >= 0 && input.mask <= 10)) {
      return { error: "mask must be a number from 0 to 10." };
    }
    settings.mask = input.mask;
  }

  if (input.date !== undefined) {
    const ms = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date)
      ? Date.parse(`${input.date}T00:00:00Z`)
      : NaN;
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== input.date) {
      return { error: "date must be a real date like 2026-11-01." };
    }
    settings.startMs = ms;
  }

  return { settings };
}

// Optional na history ng usapan, para sa mga follow-up na tanong. Hanggang 8 mensahe lang.
function checkHistory(input) {
  if (input === undefined || input === null) return { history: [] };
  if (!Array.isArray(input) || input.length > 8) {
    return { error: "history must be a list of at most 8 messages." };
  }
  const history = [];
  for (const m of input) {
    const ok = m && (m.role === "user" || m.role === "daryl") && typeof m.text === "string" && m.text.length <= 1500;
    if (!ok) return { error: "Each history item needs a role (user or daryl) and text under 1500 characters." };
    history.push({ role: m.role, text: m.text });
  }
  return { history };
}

export function createApp({
  providerFactory = createDarylProvider,
  store,
  allowedOrigins = [],
  maxBodyBytes = 20 * 1024,
  maxQuestionLength = 2000,
  timeoutMs = 15000,
  rateLimit = { max: 30, windowMs: 60000 },
  trustProxy = false,
  log = console
} = {}) {
  const hits = new Map(); // ip -> timestamps

  const sweep = setInterval(() => {
    const cutoff = Date.now() - rateLimit.windowMs;
    for (const [ip, times] of hits) {
      if (times.every(t => t < cutoff)) hits.delete(ip);
    }
  }, rateLimit.windowMs);
  sweep.unref();

  function clientIp(req) {
    if (trustProxy) {
      const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
      if (forwarded) return forwarded;
    }
    return req.socket.remoteAddress ?? "unknown";
  }

  // returns seconds to wait, or 0 kung okay pa
  function limited(ip) {
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter(t => t > now - rateLimit.windowMs);
    if (recent.length >= rateLimit.max) {
      hits.set(ip, recent);
      return Math.max(1, Math.ceil((recent[0] + rateLimit.windowMs - now) / 1000));
    }
    recent.push(now);
    hits.set(ip, recent);
    return 0;
  }

  // null = bawal ang origin. {} = walang Origin header (hindi browser).
  function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin) return {};

    let sameOrigin = false;
    try { sameOrigin = new URL(origin).host === req.headers.host; } catch {}

    const matches = o => (o instanceof RegExp ? o.test(origin) : o === origin);
    const allowed = sameOrigin || allowedOrigins.includes("*") || allowedOrigins.some(matches);
    return allowed ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : null;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      let tooLarge = false;

      req.on("data", chunk => {
        size += chunk.length;
        if (size > maxBodyBytes) {
          tooLarge = true;
          if (size > maxBodyBytes * 10) req.destroy(); // huwag nang magpatuloy sa napakalaking body
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => (tooLarge ? reject(Object.assign(new Error("too large"), { code: 413 })) : resolve(Buffer.concat(chunks).toString("utf8"))));
      req.on("error", reject);
    });
  }

  async function handleAsk(req, res, cors) {
    if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
      return sendJson(res, 415, { ok: false, status: "BAD_REQUEST", message: "Content-Type must be application/json." }, cors);
    }

    let raw;
    try {
      raw = await readBody(req);
    } catch (error) {
      if (error.code === 413) {
        return sendJson(res, 413, { ok: false, status: "BAD_REQUEST", message: "Request is too large." }, cors);
      }
      return;
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return sendJson(res, 400, { ok: false, status: "BAD_REQUEST", message: "Body must be valid JSON." }, cors);
    }

    const question = body?.question;
    if (typeof question !== "string" || !question.trim()) {
      return sendJson(res, 400, { ok: false, status: "BAD_REQUEST", message: "question must be non-empty text." }, cors);
    }
    if (question.length > maxQuestionLength) {
      return sendJson(res, 400, { ok: false, status: "BAD_REQUEST", message: `question is too long (max ${maxQuestionLength} characters).` }, cors);
    }

    const checked = checkSettings(body.settings);
    if (checked.error) {
      return sendJson(res, 400, { ok: false, status: "BAD_REQUEST", message: checked.error }, cors);
    }

    const past = checkHistory(body.history);
    if (past.error) {
      return sendJson(res, 400, { ok: false, status: "BAD_REQUEST", message: past.error }, cors);
    }

    let provider;
    try {
      provider = providerFactory({ ...checked.settings, history: past.history });
    } catch (error) {
      if (error.code === "NO_DATA") {
        log.error?.(`No site data: ${error.message}`);
        return sendJson(res, 503, { ok: false, status: "NO_DATA", message: "Daryl isn't set up yet. Please check back later." }, cors);
      }
      return sendJson(res, 400, { ok: false, status: "BAD_REQUEST", message: error.message }, cors);
    }

    const requestId = randomBytes(4).toString("hex");
    const result = await runDiagnosticCycle(question, provider, { timeoutMs, store });

    if (result.status === "SUCCESS") {
      return sendJson(res, 200, {
        ok: true, status: "SUCCESS", answer: result.output, durationMs: result.durationMs, requestId
      }, cors);
    }

    if (result.status === "INVALID_INPUT") {
      return sendJson(res, 400, { ok: false, status: "BAD_REQUEST", message: result.reason, requestId }, cors);
    }

    /* Ang details (diagnosis, repair plan) ay sa server log lang at sa incident log.
    Hindi sila ibinabalik sa mga bisita ng website. */
    log.error?.(`[${requestId}] ${result.status}: ${result.diagnosis?.cause ?? result.reason ?? "unknown"}`);

    if (result.diagnosis?.cause === "Timeout") {
      return sendJson(res, 504, { ok: false, status: "TIMEOUT", message: "That took too long. Please try again.", requestId }, cors);
    }
    return sendJson(res, 502, { ok: false, status: "ERROR", message: GENERIC_ERROR, requestId }, cors);
  }

  async function handler(req, res) {
    const url = new URL(req.url, "http://localhost");
    const route = url.pathname;

    // static files (GET lang)
    if (STATIC[route]) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return sendJson(res, 405, { ok: false, status: "BAD_REQUEST", message: "Method not allowed." }, { Allow: "GET, HEAD" });
      }
      const [file, type] = STATIC[route];
      const content = await readFile(path.join(PUBLIC, file));
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": content.length,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        ...(type.startsWith("text/html") ? { "Content-Security-Policy": PAGE_CSP } : {})
      });
      return res.end(req.method === "HEAD" ? undefined : content);
    }

    if (!route.startsWith("/api/")) {
      return sendJson(res, 404, { ok: false, status: "NOT_FOUND", message: "Not found." });
    }

    const cors = corsHeaders(req);
    if (cors === null) {
      return sendJson(res, 403, { ok: false, status: "ORIGIN_NOT_ALLOWED", message: "This website isn't allowed to use this API." });
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...cors,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600"
      });
      return res.end();
    }

    const routes = {
      "/api/health": "GET",
      "/api/sites": "GET",
      "/api/ask": "POST"
    };
    if (!routes[route]) {
      return sendJson(res, 404, { ok: false, status: "NOT_FOUND", message: "Not found." }, cors);
    }
    if (req.method !== routes[route]) {
      return sendJson(res, 405, { ok: false, status: "BAD_REQUEST", message: "Method not allowed." }, { ...cors, Allow: routes[route] });
    }

    // hindi kasama ang health check sa rate limit, para hindi ma-block ang monitoring
    if (route !== "/api/health") {
      const wait = limited(clientIp(req));
      if (wait) {
        return sendJson(res, 429, { ok: false, status: "RATE_LIMITED", message: "Too many requests. Please wait a moment." }, { ...cors, "Retry-After": String(wait) });
      }
    }

    if (route === "/api/health") {
      return sendJson(res, 200, { ok: true, name: "Daryl", version: VERSION, ready: SITES.length > 0 }, cors);
    }
    if (route === "/api/sites") {
      return sendJson(res, 200, {
        ok: true,
        sites: SITES.map(([name, latitude, longitude], index) => ({ index, name, latitude, longitude }))
      }, cors);
    }
    return handleAsk(req, res, cors);
  }

  const server = http.createServer((req, res) => {
    handler(req, res).catch(error => {
      log.error?.(`Unexpected error: ${error?.stack ?? error}`);
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, status: "ERROR", message: GENERIC_ERROR });
      } else {
        res.end();
      }
    });
  });
  server.on("close", () => clearInterval(sweep));
  return server;
}
