import { receiveReport } from "../protected/master.js";

export function analyzeTests(testCheck) {
  let message;

  if (testCheck.passed) {
    message = `All ${testCheck.total} tests passed.`;
  } else if (testCheck.reason) {
    message = `Tests could not be verified: ${testCheck.reason}`;
  } else {
    message = `${testCheck.failed} test(s) failed.`;
  }

  return receiveReport("verifier", message);
}
