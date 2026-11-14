import test from "node:test";
import assert from "node:assert/strict";

import { validateInput } from "../diagnostics/input.js";
import { verifyOutput } from "../diagnostics/output.js";
import { findRootCause } from "../diagnostics/root-cause.js";
import { verifyTests } from "../diagnostics/testing.js";
import { createRepairPlan } from "../diagnostics/repair.js";
import { monitorExecution } from "../diagnostics/monitor.js";
import { approveRepair, receiveReport } from "../protected/master.js";

test("rejects empty input", () => {
  assert.equal(validateInput("   ").valid, false);
});

test("accepts valid input", () => {
  assert.equal(validateInput("Check this program").valid, true);
});

test("rejects empty output", () => {
  assert.equal(verifyOutput("").valid, false);
});

test("detects a connection failure", () => {
  assert.equal(findRootCause("ECONNREFUSED").cause, "Connection failure");
});

test("rejects failed test results", () => {
  const result = verifyTests([{ name: "Example test", passed: false }]);
  assert.equal(result.passed, false);
});

test("requires review for a proposed repair", () => {
  const plan = createRepairPlan("Example error", {
    cause: "Example cause",
    suggestion: "Check the relevant code."
  });
  assert.equal(plan.status, "REVIEW_REQUIRED");
});

test("missing module errors mentioning package.json are not misread as JSON errors", () => {
  const result = findRootCause("Cannot find module '/app/package.json'");
  assert.equal(result.cause, "Module or import error");
});

test("verifyTests survives null entries", () => {
  const result = verifyTests([null, undefined, { passed: true }]);
  assert.equal(result.passed, false);
  assert.equal(result.failed, 2);
});

test("monitorExecution times out a hanging task", async () => {
  const result = await monitorExecution(() => new Promise(() => {}), {
    timeoutMs: 50
  });
  assert.equal(result.success, false);
  assert.match(result.error, /Timeout/);
});

test("monitorExecution catches synchronous throws", async () => {
  const result = await monitorExecution(() => {
    throw new Error("boom");
  });
  assert.equal(result.success, false);
  assert.equal(result.error, "boom");
});

test("rejects reports from unknown agents", () => {
  assert.throws(() => receiveReport("intruder", "hi"), /Unauthorized/);
});

test("approveRepair needs a plan, passing tests, and a named human", () => {
  const plan = { status: "REVIEW_REQUIRED" };
  const testCheck = { passed: true };

  assert.equal(approveRepair().approved, false);
  assert.equal(approveRepair({ plan, testCheck: { passed: false }, approvedBy: "Ana" }).approved, false);
  assert.equal(approveRepair({ plan, testCheck }).approved, false);
  assert.equal(approveRepair({ plan, testCheck, approvedBy: "Ana" }).approved, true);
});
