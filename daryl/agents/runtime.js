import { receiveReport } from "../protected/master.js";

export function analyzeRuntime(result) {
  return receiveReport(
    "runtime",
    result.success
      ? "Execution completed successfully."
      : `Execution failed: ${result.error}`
  );
}
