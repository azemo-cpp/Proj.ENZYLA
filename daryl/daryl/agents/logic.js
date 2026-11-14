import { receiveReport } from "../protected/master.js";

export function analyzeLogic(outputCheck) {
  const message = outputCheck.valid
    ? "Output passed basic validation."
    : `Output validation failed: ${outputCheck.reason}`;

  return receiveReport("logic", message);
}
