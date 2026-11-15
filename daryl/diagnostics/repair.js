// Builds a plan for a human or future repair agent. Never edits files or executes generated code.
export function createRepairPlan(error, diagnosis) {
  return {
    error: String(error),
    suspectedCause: diagnosis.cause,
    suggestedAction: diagnosis.suggestion,
    instructions: [
      "Find the smallest change that could fix the problem.",
      "Explain why the change addresses the error.",
      "Create the proposed change in an isolated workspace.",
      "Run tests before considering the change.",
      "Never modify protected controller files automatically.",
      "Require human approval before deployment."
    ],
    status: "REVIEW_REQUIRED"
  };
}
