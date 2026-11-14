// Rules are checked in order, so more specific patterns go first.
const RULES = [
  {
    match: ["cannot find module", "module not found", "err_module_not_found"],
    cause: "Module or import error",
    suggestion: "Check the file path, filename, and package installation."
  },
  {
    match: ["timeout", "timed out", "etimedout"],
    cause: "Timeout",
    suggestion: "Check execution time and response delays."
  },
  {
    match: ["econnrefused", "connection refused"],
    cause: "Connection failure",
    suggestion: "Check whether the server is running and the address is correct."
  },
  {
    match: ["enotfound", "getaddrinfo"],
    cause: "DNS or network failure",
    suggestion: "Check the hostname and your network connection."
  },
  {
    match: ["eacces", "eperm", "permission denied"],
    cause: "Permission error",
    suggestion: "Check file or service permissions."
  },
  {
    match: ["429", "rate limit", "too many requests"],
    cause: "Rate limiting",
    suggestion: "Slow down requests or add retries with backoff."
  },
  {
    match: ["401", "403", "unauthorized", "invalid api key"],
    cause: "Authentication error",
    suggestion: "Check credentials and access rights."
  },
  {
    match: ["out of memory", "heap"],
    cause: "Memory exhaustion",
    suggestion: "Reduce input size or memory usage."
  },
  {
    match: ["cannot read properties", "is not a function", "is not defined"],
    cause: "Code error (undefined value or missing function)",
    suggestion: "Inspect the stack trace for the failing line."
  },
  {
    match: ["unexpected token", "in json", "json.parse", "invalid json"],
    cause: "Possible data or JSON parsing error",
    suggestion: "Check the data format and JSON syntax."
  }
];

export function findRootCause(errorMessage) {
  const message = String(errorMessage).toLowerCase();

  for (const rule of RULES) {
    if (rule.match.some(pattern => message.includes(pattern))) {
      return { cause: rule.cause, suggestion: rule.suggestion };
    }
  }

  return {
    cause: "Unknown error",
    suggestion: "Inspect the full error message and reproduce the problem."
  };
}
