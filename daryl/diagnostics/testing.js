// Checks a list of results like { name, passed }.
// Anything that is not an object with passed === true counts as a failure.
export function verifyTests(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return { passed: false, reason: "No test results were provided." };
  }

  const failedTests = results.filter(test => test?.passed !== true);

  return {
    passed: failedTests.length === 0,
    total: results.length,
    failed: failedTests.length,
    failedTests
  };
}
