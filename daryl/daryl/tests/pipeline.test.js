import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runDiagnosticCycle } from "../protected/run.js";
import { createIncidentStore } from "../diagnostics/learning.js";
import { runTestSuite } from "../diagnostics/test-runner.js";
import { verifyTests } from "../diagnostics/testing.js";

async function tempStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sdai-"));
  return { dir, store: createIncidentStore(path.join(dir, "incidents.json")) };
}

test("successful task returns output and two reports", async () => {
  const { store } = await tempStore();
  const result = await runDiagnosticCycle(
    "hello",
    { run: async () => "  hi there  " },
    { store }
  );
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.output, "hi there");
  assert.equal(result.reports.length, 2);
  assert.equal((await store.getIncidents()).length, 0);
});

test("provider error is diagnosed and recorded", async () => {
  const { store } = await tempStore();
  const result = await runDiagnosticCycle(
    "hello",
    { run: async () => { throw new Error("connect ECONNREFUSED"); } },
    { store }
  );
  assert.equal(result.status, "DIAGNOSIS_COMPLETE");
  assert.equal(result.diagnosis.cause, "Connection failure");
  assert.equal(result.incidentRecorded, true);
  assert.equal((await store.getIncidents()).length, 1);
});

test("hanging provider is reported as a timeout", async () => {
  const { store } = await tempStore();
  const result = await runDiagnosticCycle(
    "hello",
    { run: () => new Promise(() => {}) },
    { store, timeoutMs: 50 }
  );
  assert.equal(result.status, "DIAGNOSIS_COMPLETE");
  assert.equal(result.diagnosis.cause, "Timeout");
});

test("empty output is flagged", async () => {
  const { store } = await tempStore();
  const result = await runDiagnosticCycle("hello", { run: async () => "  " }, { store });
  assert.equal(result.status, "OUTPUT_ERROR");
});

test("invalid input and invalid provider are rejected", async () => {
  assert.equal((await runDiagnosticCycle("", {})).status, "INVALID_INPUT");
  assert.equal((await runDiagnosticCycle("hi", {})).status, "PROVIDER_ERROR");
});

test("failing tests turn a good output into TESTS_FAILED", async () => {
  const { store } = await tempStore();
  const result = await runDiagnosticCycle(
    "hello",
    { run: async () => "ok" },
    { store, runTests: async () => [{ name: "t", passed: false }] }
  );
  assert.equal(result.status, "TESTS_FAILED");
  assert.equal(result.reports.length, 3);
  assert.equal((await store.getIncidents())[0].status, "TESTS_FAILED");
});

test("a broken incident store does not hide the diagnosis", async () => {
  const store = { recordIncident: async () => { throw new Error("disk full"); } };
  const result = await runDiagnosticCycle(
    "hello",
    { run: async () => { throw new Error("boom"); } },
    { store }
  );
  assert.equal(result.status, "DIAGNOSIS_COMPLETE");
  assert.equal(result.incidentRecorded, false);
});

test("simultaneous incidents are all kept", async () => {
  const { store } = await tempStore();
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => store.recordIncident({ n: i, diagnosis: { cause: "X" } }))
  );
  assert.equal((await store.getIncidents()).length, 20);
  assert.deepEqual(await store.summarize(), [{ cause: "X", count: 20 }]);
});

test("a corrupted incident file gives a clear error", async () => {
  const { dir, store } = await tempStore();
  await writeFile(path.join(dir, "incidents.json"), "{not json", "utf8");
  await assert.rejects(store.getIncidents(), /corrupted/);
});

/* Sa sandbox bawal mag-spawn ng process, kaya skip ang test na ito doon. */
const canSpawn = process.permission ? process.permission.has("child") : true;

test("runTestSuite reports real pass and fail results", { skip: !canSpawn }, async () => {
  const pass = await mkdtemp(path.join(os.tmpdir(), "sdai-pass-"));
  await writeFile(path.join(pass, "a.test.js"),
    `import test from "node:test"; test("ok", () => {});`);
  const fail = await mkdtemp(path.join(os.tmpdir(), "sdai-fail-"));
  await writeFile(path.join(fail, "a.test.js"),
    `import test from "node:test"; import assert from "node:assert"; test("bad", () => assert.equal(1, 2));`);

  assert.equal(verifyTests(await runTestSuite(pass)).passed, true);
  assert.equal(verifyTests(await runTestSuite(fail)).passed, false);
});
