/* Runs taskFunction(signal) and reports success, failure, or timeout.
   A timeout cannot force-stop the task. It aborts the signal, which the
   task must check, and stops waiting for the result. */
export async function monitorExecution(
  taskFunction,
  { timeoutMs = 30000 } = {}
) {
  const start = Date.now();
  const controller = new AbortController();
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Timeout: task exceeded ${timeoutMs} ms`));
    }, timeoutMs);
  });

  try {
    // Promise.resolve().then(...) also catches synchronous throws.
    const result = await Promise.race([
      Promise.resolve().then(() => taskFunction(controller.signal)),
      timeout
    ]);

    return { success: true, result, durationMs: Date.now() - start };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start
    };
  } finally {
    clearTimeout(timer);
  }
}
