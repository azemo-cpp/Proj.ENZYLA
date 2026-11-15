export function verifyOutput(output) {
  if (typeof output !== "string") {
    return { valid: false, reason: "Output must be a string." };
  }

  const trimmed = output.trim();

  if (!trimmed) {
    return { valid: false, reason: "Output is empty." };
  }

  if (/\bNaN\b|\bundefined\b|\[object Object\]|\bInfinity\b/.test(trimmed)) {
    return {
      valid: false,
      reason: "Output contains NaN, undefined, Infinity, or [object Object]."
    };
  }

  return { valid: true, output: trimmed };
}
