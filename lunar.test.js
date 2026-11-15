import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createDarylProvider } from "../providers/lunar/index.js";
import { SITES } from "../providers/lunar/planner.js";
import { runDiagnosticCycle } from "../protected/run.js";
import { createIncidentStore } from "../diagnostics/learning.js";
import { verifyOutput } from "../diagnostics/output.js";

const START = Date.parse("2026-11-01T00:00:00Z");

/* Site names come from the site list, so these tests keep working
kahit palitan mo ng real database ang data. */
const A = 0;
const B = 1;
const nameA = SITES[A]?.[0];
const nameB = SITES[B]?.[0];

async function store() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "daryl-"));
  return createIncidentStore(path.join(dir, "incidents.json"));
}

test("Daryl answers a site comparison through the pipeline", async () => {
  const daryl = createDarylProvider({ siteA: A, siteB: B, days: 10, startMs: START });
  const result = await runDiagnosticCycle(
    `Compare ${nameA} and ${nameB} for 10 days`,
    daryl,
    { store: await store() }
  );
  assert.equal(result.status, "SUCCESS");
  assert.ok(result.output.includes(nameA));
  assert.ok(result.output.includes(nameB));
});

test("Daryl explains the colours", async () => {
  const daryl = createDarylProvider({ startMs: START });
  const result = await runDiagnosticCycle("What does the red mean?", daryl, {
    store: await store()
  });
  assert.equal(result.status, "SUCCESS");
  assert.match(result.output, /Poor/);
});

test("Daryl gives the same answer for the same inputs", async () => {
  const daryl = createDarylProvider({ startMs: START });
  const a = await daryl.run(`Tell me about ${nameA}`);
  const b = await daryl.run(`Tell me about ${nameA}`);
  assert.equal(a, b);
});

test("bad site numbers are rejected up front", () => {
  assert.throws(() => createDarylProvider({ siteA: 99 }), /Site numbers/);
});

test("an aborted run reports a timeout", async () => {
  const daryl = createDarylProvider({ startMs: START });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(daryl.run("hi", controller.signal), /Timeout/);
});

test("output containing NaN is flagged as invalid", () => {
  assert.equal(verifyOutput("Sunlit: NaN%").valid, false);
  assert.equal(verifyOutput("Sunlit: 62%").valid, true);
});

test("a corrupted Daryl answer is caught and recorded", async () => {
  const s = await store();
  const broken = { run: async () => "Best score: NaN" };
  const result = await runDiagnosticCycle("hello", broken, { store: s });
  assert.equal(result.status, "OUTPUT_ERROR");
  assert.equal((await s.getIncidents()).length, 1);
});

test("the site list has the expected shape", async () => {
  const { SITES } = await import("../database/sites.js");
  assert.ok(SITES.length >= 2, "need at least 2 sites");
  for (const [name, lat, lon, description] of SITES) {
    assert.equal(typeof name, "string");
    assert.ok(description === undefined || typeof description === "string");
    assert.ok(lat >= -90 && lat <= 90);
    assert.ok(lon >= -180 && lon <= 180);
  }
});

test("Daryl finds a site by its full name, in any letter case", async () => {
  const daryl = createDarylProvider({ startMs: START });
  const info = await daryl.run(`tell me about ${nameB.toUpperCase()}`);
  assert.ok(info.includes(nameB));
});

test("a name that isn't in the site list doesn't pull up any site", async () => {
  const daryl = createDarylProvider({ startMs: START });
  const answer = await daryl.run("Tell me about Nowhere Base");
  assert.ok(!SITES.some(([name]) => answer.includes(`${name}:`)));
});

test("a site's description from the data is used in its info", async () => {
  const withText = SITES.find(site => site[3]);
  if (!withText) return; // walang description ang data, okay lang
  const daryl = createDarylProvider({ startMs: START });
  const answer = await daryl.run(`Tell me about ${withText[0]}`);
  assert.ok(answer.includes(withText[3].slice(0, 30)));
});

test("the example questions use real site names, not placeholders", async () => {
  const daryl = createDarylProvider({ startMs: START });
  const answer = await daryl.run("asdfgh qwerty");
  assert.ok(!answer.includes("{A}") && !answer.includes("{B}"));
  assert.ok(answer.includes(nameA));
});
