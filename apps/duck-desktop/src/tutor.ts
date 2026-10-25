export type TutorMode = "ideate" | "build" | "debug";
export interface Project { root: string; name: string }
export interface PlanStep { id: string; text: string; done: boolean; sourceTurnId?: string }
export interface ContextAttachment { id: string; kind: "file" | "code" | "error"; label: string; text: string }
export interface ChatTurn { id: string; question: string; answer: string; mode: TutorMode; attachments: ContextAttachment[] }
export interface TutorSession {
  version: 1;
  mode: TutorMode;
  goal: string;
  steps: PlanStep[];
  notes: string;
  draft: string;
  attachments: ContextAttachment[];
  turns: ChatTurn[];
}

export const MODE_HINTS = {
  ideate: "Describe your idea. We'll clarify who it helps, what it needs, and a small first version.",
  build: "Describe the feature you're building. We'll make a small plan and work through one step at a time.",
  debug: "What did you expect, what happened, and what have you already tried?",
};

const MAX_REPLY_CHARS = 100_000;
export function replyForSession(reply: string): string {
  if (reply.length <= MAX_REPLY_CHARS) return reply;
  const notice = "\n\nReply shortened to keep your progress saveable. Ask about a smaller part to continue.";
  return reply.slice(0, MAX_REPLY_CHARS - notice.length) + notice;
}

export function createSession(): TutorSession {
  return { version: 1, mode: "build", goal: "", steps: [], notes: "", draft: "", attachments: [], turns: [] };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}
function mode(value: unknown): value is TutorMode {
  return value === "ideate" || value === "build" || value === "debug";
}
function attachment(value: unknown): value is ContextAttachment {
  return record(value) && text(value.id, 100) && (value.kind === "file" || value.kind === "code" || value.kind === "error") && text(value.label, 500) && text(value.text, 65_536);
}
function step(value: unknown): value is PlanStep {
  return record(value) && text(value.id, 100) && text(value.text, 500) && typeof value.done === "boolean" && (value.sourceTurnId === undefined || text(value.sourceTurnId, 100));
}
function turn(value: unknown): value is ChatTurn {
  return record(value) && text(value.id, 100) && text(value.question, 12_000) && text(value.answer, MAX_REPLY_CHARS) && mode(value.mode) && Array.isArray(value.attachments) && value.attachments.length <= 3 && value.attachments.every(attachment);
}

export function parseSession(raw: string): TutorSession {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 1 || !mode(value.mode) || !text(value.goal, 240) || !text(value.notes, 12_000) || !text(value.draft, 12_000)
    || !Array.isArray(value.steps) || value.steps.length > 30 || !value.steps.every(step)
    || !Array.isArray(value.attachments) || value.attachments.length > 3 || !value.attachments.every(attachment)
    || !Array.isArray(value.turns) || value.turns.length > 40 || !value.turns.every(turn)) {
    throw new Error("Saved progress could not be restored. It has not been overwritten.");
  }
  return { version: 1, mode: value.mode, goal: value.goal, notes: value.notes, draft: value.draft, steps: value.steps, attachments: value.attachments, turns: value.turns };
}

export function suggestedSteps(answer: string): string[] {
  return [...answer.matchAll(/^\s*[-*]\s+\[[ xX]\]\s+(.+)$/gm)].map((match) => match[1].trim().slice(0, 500)).filter(Boolean).slice(0, 12);
}

export function composeMessage(session: TutorSession, question: string): string {
  const history = session.turns.slice(-8).map((turn) => ({ question: turn.question, answer: turn.answer.slice(0, 8_000), mode: turn.mode,
    context: turn.attachments.map((context) => ({ kind: context.kind, label: context.label, text: context.text.slice(0, 4_000) })) }));
  const context = { goal: session.goal, plan: session.steps.map(({ text, done }) => ({ text, checkedByLearner: done })), notesAndAttempts: session.notes, recentConversation: history, attachedContext: session.attachments };
  return `Learning context (JSON, supplied by the learner):\n${JSON.stringify(context)}\n\nCurrent question:\n${question}`;
}
