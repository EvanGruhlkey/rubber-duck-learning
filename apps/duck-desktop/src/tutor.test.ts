import { describe, expect, it } from "vitest";
import { createSession, parseSession, suggestedSteps, composeMessage, replyForSession } from "./tutor";

describe("learning sessions", () => {
  it("keeps oversized CLI replies restorable and makes truncation visible", () => {
    const answer = replyForSession("x".repeat(100_001));
    const session = { ...createSession(), turns: [{ id: "long-turn", question: "Explain", answer, mode: "build", attachments: [] }] };
    expect(answer.length).toBeLessThanOrEqual(100_000);
    expect(answer).toContain("Reply shortened");
    expect(parseSession(JSON.stringify(session)).turns[0].answer).toBe(answer);
  });
  it("starts in Build mode with no invented progress", () => {
    const session = createSession();
    expect(session.mode).toBe("build");
    expect(session.steps).toEqual([]);
    expect(session.goal).toBe("");
  });

  it("restores the goal, user-checked steps, attempts, and conversation", () => {
    const session = { ...createSession(), goal: "Add login", notes: "Tried a missing password", steps: [{ id: "step-1", text: "Define login behavior", done: true }], turns: [{ id: "turn-1", question: "Where do I start?", answer: "Define the behavior.", mode: "build", attachments: [] }] };
    expect(parseSession(JSON.stringify(session))).toEqual(session);
  });

  it("rejects corrupt sessions rather than quietly replacing their data", () => {
    expect(() => parseSession("not JSON")).toThrow();
    expect(() => parseSession(JSON.stringify({ ...createSession(), mode: "write-code" }))).toThrow();
    expect(() => parseSession(JSON.stringify({ ...createSession(), steps: [{ text: "Broken", done: "yes" }] }))).toThrow();
  });

  it("recognizes suggested steps without treating model checkmarks as completed work", () => {
    expect(suggestedSteps("A plan:\n- [ ] Define behavior\n- [x] Write the first test\nOther text")).toEqual(["Define behavior", "Write the first test"]);
    expect(createSession().steps).toEqual([]);
  });

  it("includes the saved learning context and attached selection in the next question", () => {
    const session = { ...createSession(), goal: "Add login", notes: "A blank password failed", steps: [{ id: "step-1", text: "Validate inputs", done: false }], attachments: [{ id: "context-1", kind: "code" as const, label: "Pasted code", text: "if (!password) return false;" }] };
    const prompt = composeMessage(session, "What should I try next?");
    expect(prompt).toContain("Add login");
    expect(prompt).toContain("A blank password failed");
    expect(prompt).toContain("Validate inputs");
    expect(prompt).toContain("if (!password) return false;");
    expect(prompt).toContain("What should I try next?");
  });
});
