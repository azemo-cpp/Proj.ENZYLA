const ALLOWED_AGENTS = new Set(["runtime", "logic", "verifier"]);

export function receiveReport(agent, message) {
  if (!ALLOWED_AGENTS.has(agent)) {
    throw new Error("Unauthorized agent.");
  }

  if (typeof message !== "string" || !message.trim()) {
    throw new Error("Invalid report.");
  }

  return Object.freeze({
    agent,
    message,
    receivedAt: new Date().toISOString()
  });
}

// Records a decision only. It never deploys anything.
// Approval needs a repair plan awaiting review, passing tests,
// and a named human.
export function approveRepair({ plan, testCheck, approvedBy } = {}) {
  if (!plan || plan.status !== "REVIEW_REQUIRED") {
    return { approved: false, reason: "No repair plan awaiting review." };
  }

  if (!testCheck || testCheck.passed !== true) {
    return {
      approved: false,
      reason: "Repair has not passed independent testing."
    };
  }

  if (typeof approvedBy !== "string" || !approvedBy.trim()) {
    return { approved: false, reason: "Human approval is required." };
  }

  return {
    approved: true,
    approvedBy: approvedBy.trim(),
    approvedAt: new Date().toISOString()
  };
}
