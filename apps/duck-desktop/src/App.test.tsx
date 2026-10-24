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

beforeAll(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => { vi.mocked(invoke).mockReset(); });
afterEach(cleanup);

async function openDuck() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
  return user;
}

describe("duck conversation", () => {
  it("keeps a draft when the panel is hidden and reopened", async () => {
    const user = await openDuck();
    await user.type(screen.getByRole("textbox"), "Why does this loop stop?");
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("Why does this loop stop?");
  });

  it("keeps replies and includes them in a follow-up", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("What is the loop condition?").mockResolvedValueOnce("Trace the first iteration.");
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
      expect(invoke).toHaveBeenNthCalledWith(2, "duck_ask", expect.objectContaining({ message: expect.stringContaining(text) }));
    }
  });

  it("keeps a pending request busy after hiding the panel", async () => {
    let finish: (reply: string) => void = () => { throw new Error("Request was not started"); };
    vi.mocked(invoke).mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const user = await openDuck();
    await user.type(screen.getByRole("textbox"), "Explain this error");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Thinking/ }).disabled).toBe(true);
    expect(vi.mocked(invoke).mock.calls).toHaveLength(1);
    await act(async () => finish("What changed before the error?"));
    expect(await screen.findByText("What changed before the error?")).toBeTruthy();
  });

  it("only clears the conversation when New chat is pressed", async () => {
    vi.mocked(invoke).mockResolvedValue("What have you tried?");
    const user = await openDuck();
    await user.type(screen.getByRole("textbox"), "I am stuck");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    await screen.findByText("What have you tried?");
    await user.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.queryByText("What have you tried?")).toBeNull();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("");
  });
});
