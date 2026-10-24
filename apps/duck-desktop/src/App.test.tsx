// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging: vi.fn() }),
}));

const ask = vi.fn();
const cancel = vi.fn();
const catalog = {
  ide: "codex",
  models: [{ id: "gpt-example-a", label: "GPT Example A" }, { id: "gpt-example-b", label: "GPT Example B" }],
  warning: null,
};

beforeAll(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  ask.mockReset();
  cancel.mockReset().mockResolvedValue(undefined);
  vi.mocked(invoke).mockReset().mockImplementation((command) => {
    if (command === "duck_models") return Promise.resolve(catalog);
    if (command === "duck_cancel") return cancel();
    if (command === "duck_ask") return ask();
    return Promise.reject(new Error(`Unexpected command: ${command}`));
  });
});
afterEach(cleanup);

async function openDuck() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
  return user;
}

describe("duck conversation", () => {
  it("blocks requests when the launching IDE cannot be detected", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("Could not detect your IDE.");
    const user = await openDuck();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Could not detect your IDE.");
    await user.type(screen.getByRole("textbox"), "Explain loops");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Ask the duck" }).disabled).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("offers only the IDE default if discovery fails without inventing other models", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ide: "claude", models: [], warning: "Model list unavailable. Using your IDE's default." });
    await openDuck();
    expect(await screen.findByText("Claude Code")).toBeTruthy();
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["CLI default"]);
    expect(screen.getByText("Model list unavailable. Using your IDE's default.")).toBeTruthy();
  });

  it("keeps every model family available through Cursor", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ide: "cursor", models: [{ id: "gpt-example", label: "GPT Example" }, { id: "claude-example", label: "Claude Example" }, { id: "composer-example", label: "Composer Example" }], warning: null });
    await openDuck();
    expect(await screen.findByText("Cursor")).toBeTruthy();
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["GPT Example", "Claude Example", "Composer Example"]);
  });

  it("only offers the current IDE's models and locks selection while answering", async () => {
    let finish: (reply: string) => void = () => { throw new Error("Request was not started"); };
    ask.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const user = await openDuck();
    const picker = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Model" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["GPT Example A", "GPT Example B"]);
    expect(screen.queryByRole("option", { name: "Claude Code" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Cursor" })).toBeNull();
    await user.selectOptions(picker, "gpt-example-b");
    await user.type(screen.getByRole("textbox"), "Explain loops");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    expect(invoke).toHaveBeenCalledWith("duck_ask", expect.objectContaining({ model: "gpt-example-b", message: "Explain loops" }));
    expect(picker.disabled).toBe(true);
    await act(async () => finish("A loop repeats a step."));
    expect(picker.disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Model" }).value).toBe("gpt-example-b");
  });

  it("opens and hides the panel with the keyboard", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("textbox")).toBeTruthy();
    await user.keyboard(" ");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("stops a request, keeps the draft, and ignores a reply arriving during Stop", async () => {
    let finish: (reply: string) => void = () => { throw new Error("Request was not started"); };
    ask.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const user = await openDuck();
    await user.type(screen.getByRole("textbox"), "Explain this error");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(invoke).toHaveBeenLastCalledWith("duck_cancel", expect.objectContaining({ requestId: expect.any(Number) }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Stopping/ }).disabled).toBe(true);
    await act(async () => finish("A stale reply"));
    expect(screen.queryByText("A stale reply")).toBeNull();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("Explain this error");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Ask the duck" }).disabled).toBe(false);
  });

  it("keeps the question available after a timeout", async () => {
    ask.mockRejectedValue("Request timed out. Try again or ask a shorter question.");
    const user = await openDuck();
    await user.type(screen.getByRole("textbox"), "Explain this error");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Request timed out. Try again or ask a shorter question.");
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("Explain this error");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Ask the duck" }).disabled).toBe(false);
  });

  it("keeps a draft when the panel is hidden and reopened", async () => {
    const user = await openDuck();
    await user.type(screen.getByRole("textbox"), "Why does this loop stop?");
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("Why does this loop stop?");
  });

  it("keeps replies and includes them in a follow-up", async () => {
    ask.mockResolvedValueOnce("What is the loop condition?").mockResolvedValueOnce("Trace the first iteration.");
    const user = await openDuck();
    await user.type(screen.getByRole("textbox"), "My loop stops early");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    await screen.findByText("What is the loop condition?");
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    expect(screen.getByText("What is the loop condition?")).toBeTruthy();
    await user.type(screen.getByRole("textbox"), "It checks i < 3");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    await screen.findByText("Trace the first iteration.");
    for (const text of ["My loop stops early", "What is the loop condition?", "It checks i < 3"]) {
      expect(invoke).toHaveBeenCalledWith("duck_ask", expect.objectContaining({ message: expect.stringContaining(text) }));
    }
  });

  it("keeps a pending request busy after hiding the panel", async () => {
    let finish: (reply: string) => void = () => { throw new Error("Request was not started"); };
    ask.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const user = await openDuck();
    await user.type(screen.getByRole("textbox"), "Explain this error");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Thinking/ }).disabled).toBe(true);
    expect(ask.mock.calls).toHaveLength(1);
    await act(async () => finish("What changed before the error?"));
    expect(await screen.findByText("What changed before the error?")).toBeTruthy();
  });

  it("only clears the conversation when New chat is pressed", async () => {
    ask.mockResolvedValue("What have you tried?");
    const user = await openDuck();
    await user.type(screen.getByRole("textbox"), "I am stuck");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    await screen.findByText("What have you tried?");
    await user.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.queryByText("What have you tried?")).toBeNull();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("");
  });
});
