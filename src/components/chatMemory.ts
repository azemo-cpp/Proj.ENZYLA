export interface ChatMessage { id: number; role: 'user' | 'daryl'; text: string; error?: boolean }

const LIMIT = 120;
const MAX_TEXT = 4000;

const greetingOnly = (greeting: string): ChatMessage[] => [{ id: 0, role: 'daryl', text: greeting }];

// Restores the saved conversation so Daryl keeps its memory across reloads.
export function loadChat(key: string, greeting: string): ChatMessage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (!Array.isArray(raw)) return greetingOnly(greeting);
    const saved = raw
      .filter((m: any) => m && (m.role === 'user' || m.role === 'daryl') && typeof m.text === 'string' && m.text.trim() && m.text !== 'Thinking…')
      .slice(-LIMIT)
      .map((m: any, i: number) => ({ id: i + 1, role: m.role, text: m.text.slice(0, MAX_TEXT) }));
    return saved.length ? [{ id: 0, role: 'daryl', text: greeting }, ...saved] : greetingOnly(greeting);
  } catch {
    return greetingOnly(greeting);
  }
}

export function saveChat(key: string, messages: ChatMessage[]) {
  try {
    const keep = messages
      .filter((m) => m.id !== 0 && !m.error && m.text.trim() && m.text !== 'Thinking…')
      .slice(-LIMIT)
      .map(({ role, text }) => ({ role, text: text.slice(0, MAX_TEXT) }));
    localStorage.setItem(key, JSON.stringify(keep));
  } catch {
    /* storage blocked or full: the conversation still works for this session */
  }
}

export function nextChatId(messages: ChatMessage[]) {
  return Math.max(0, ...messages.map((m) => m.id)) + 1;
}
