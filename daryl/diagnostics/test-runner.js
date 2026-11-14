import { execFile } from "node:child_process";

/* Really runs `node --test` in the given folder (no shell involved)
and returns results in the shape verifyTests() expects. */
export function runTestSuite(cwd, { timeoutMs = 60000 } = {}) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // lets this work when called from a test

  return new Promise(resolve => {
    execFile(
      process.execPath,
      ["--test"],
      { cwd, env, timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`.trim();
        resolve([
          {
            name: "node --test",
            passed: !error,
            exitCode: error ? (error.code ?? "unknown") : 0,
            outputTail: output.slice(-2000)
          }
        ]);
      }
    );
  });
}
