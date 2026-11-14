export const MAX_INPUT_LENGTH = 10000;

export function validateInput(task) {
  if (typeof task !== "string") {
    return { valid: false, reason: "Input must be text." };
  }

  const trimmed = task.trim();

  if (!trimmed) {
    return { valid: false, reason: "Input cannot be empty." };
  }

  if (trimmed.length > MAX_INPUT_LENGTH) {
    return { valid: false, reason: "Input is too long." };
  }

  return { valid: true, task: trimmed };
}
