import { validateInput } from "../diagnostics/input.js";
import { monitorExecution } from "../diagnostics/monitor.js";
import { verifyOutput } from "../diagnostics/output.js";
import { findRootCause } from "../diagnostics/root-cause.js";
import { createRepairPlan } from "../diagnostics/repair.js";
import { verifyTests } from "../diagnostics/testing.js";
import { recordIncident as defaultRecord } from "../diagnostics/learning.js";

import { analyzeRuntime } from "../agents/runtime.js";
import { analyzeLogic } from "../agents/logic.js";
import { analyzeTests } from "../agents/verifier.js";

// options:
//   timeoutMs  - max time for the provider (default 30000)
//   store      - object with recordIncident(); defaults to memory/incidents.json
//   runTests   - optional async () => [{ name, passed }] run after a good output
export async function runDiagnosticCycle(task, aiProvider, options = {}) {
  const { timeoutMs = 30000, store, runTests } = options;
  const record = store?.recordIncident ?? defaultRecord;

  // Memory problems must never hide the diagnosis itself.
  async function remember(incident) {
    try {
      await record(incident);
      return true;
    } catch {
      return false;
    }
  }

  // 1. Validate input
  const input = validateInput(task);
  if (!input.valid) {
    return { status: "INVALID_INPUT", reason: input.reason };
  }

  if (!aiProvider || typeof aiProvider.run !== "function") {
    return {
      status: "PROVIDER_ERROR",
      reason: "The AI provider must have a run(task) function."
    };
  }

  // 2. Monitor execution (with timeout)
  const execution = await monitorExecution(
    signal => aiProvider.run(input.task, signal),
    { timeoutMs }
  );
  const runtimeReport = analyzeRuntime(execution);

  if (!execution.success) {
    // 3. Diagnose, then plan a repair
    const diagnosis = findRootCause(execution.error);
    const repairPlan = createRepairPlan(execution.error, diagnosis);

    const incidentRecorded = await remember({
      task: input.task,
      status: "EXECUTION_FAILED",
      runtimeReport,
      diagnosis,
      repairPlan
    });

    return {
      status: "DIAGNOSIS_COMPLETE",
      runtimeReport,
      diagnosis,
      repairPlan,
      incidentRecorded
    };
  }

  // 4. Verify output
  const outputCheck = verifyOutput(execution.result);
  const logicReport = analyzeLogic(outputCheck);

  if (!outputCheck.valid) {
    const diagnosis = {
      cause: "Invalid AI output",
      suggestion: outputCheck.reason
    };
    const repairPlan = createRepairPlan(outputCheck.reason, diagnosis);

    const incidentRecorded = await remember({
      task: input.task,
      status: "INVALID_OUTPUT",
      runtimeReport,
      logicReport,
      diagnosis,
      repairPlan
    });

    return {
      status: "OUTPUT_ERROR",
      runtimeReport,
      logicReport,
      diagnosis,
      repairPlan,
      incidentRecorded
    };
  }

  const reports = [runtimeReport, logicReport];

  // 5. Optionally verify tests
  if (typeof runTests === "function") {
    let results;
    try {
      results = await runTests();
    } catch (error) {
      results = [{ name: "test runner", passed: false, error: String(error) }];
    }

    const testCheck = verifyTests(results);
    const verifierReport = analyzeTests(testCheck);
    reports.push(verifierReport);

    if (!testCheck.passed) {
      const diagnosis = {
        cause: "Failing tests",
        suggestion: testCheck.reason ?? `${testCheck.failed} test(s) failed.`
      };
      const repairPlan = createRepairPlan(diagnosis.suggestion, diagnosis);

      const incidentRecorded = await remember({
        task: input.task,
        status: "TESTS_FAILED",
        runtimeReport,
        logicReport,
        verifierReport,
        diagnosis,
        repairPlan
      });

      return {
        status: "TESTS_FAILED",
        reports,
        testCheck,
        diagnosis,
        repairPlan,
        incidentRecorded
      };
    }
  }

  return {
    status: "SUCCESS",
    output: outputCheck.output,
    durationMs: execution.durationMs,
    reports
  };
}
