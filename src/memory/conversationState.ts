export type Role = "user" | "agent";

export interface Turn {
  role: Role;
  content: string;
  timestamp: number;
}

export interface ConversationState {
  id: string;
  reelUrl: string;
  currency: string;
  destination?: string;   // stored after first successful pipeline run
  history: Turn[];
}

const conversations = new Map<string, ConversationState>();

function generateId(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function createConversation(
  reelUrl: string,
  currency: string,
  firstUserMessage: string,
  firstAgentMessage: string,
  destination?: string
): ConversationState {
  const id = generateId();
  const now = Date.now();

  const state: ConversationState = {
    id,
    reelUrl,
    currency,
    destination,
    history: [
      { role: "user", content: firstUserMessage, timestamp: now },
      { role: "agent", content: firstAgentMessage, timestamp: now },
    ],
  };

  conversations.set(id, state);
  return state;
}

export function getConversation(id: string): ConversationState | undefined {
  return conversations.get(id);
}

export function updateConversationCurrency(id: string, currency: string): void {
  const state = conversations.get(id);
  if (!state) return;
  state.currency = currency;
}

export function updateConversationDestination(id: string, destination: string): void {
  const state = conversations.get(id);
  if (!state) return;
  state.destination = destination;
}

export function appendTurn(id: string, role: Role, content: string): void {
  const state = conversations.get(id);
  if (!state) return;
  state.history.push({ role, content, timestamp: Date.now() });
}

export function buildHistoryText(state: ConversationState): string {
  return state.history
    .map((t) => `${t.role === "user" ? "User" : "Agent"}: ${t.content}`)
    .join("\n");
}
