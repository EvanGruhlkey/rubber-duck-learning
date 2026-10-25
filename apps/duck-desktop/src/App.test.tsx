// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class { onmessage = (_message: string) => {}; } }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging: vi.fn() }),
}));
vi.mock("./panel", () => ({ resizePanel: vi.fn().mockResolvedValue(undefined) }));

const ask = vi.fn();
const cancel = vi.fn();
const modelList = vi.fn();
const chooseProject = vi.fn();
const attachFile = vi.fn();
const project = { root: "C:/projects/example", name: "example" };
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
  localStorage.clear();
  ask.mockReset();
  cancel.mockReset().mockResolvedValue(undefined);
  modelList.mockReset().mockResolvedValue(catalog);
  chooseProject.mockReset().mockResolvedValue(null);
  attachFile.mockReset().mockResolvedValue(null);
  vi.mocked(invoke).mockReset().mockImplementation((command, args) => {
    if (command === "duck_project") return Promise.resolve(project);
    if (command === "duck_choose_project") return chooseProject();
    if (command === "duck_attach_file") return attachFile();
    if (command === "duck_models") return modelList();
    if (command === "duck_cancel") return cancel();
    if (command === "duck_ask") return ask(args);
    return Promise.reject(new Error(`Unexpected command: ${command}`));
  });
});
afterEach(cleanup);

async function openDuck() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
  await screen.findByRole("textbox", { name: "Your input" });
  const modelSettings = document.querySelector(".model-settings > summary");
  if (modelSettings) await user.click(modelSettings);
  return user;
}

async function showInput(user: ReturnType<typeof userEvent.setup>) {
  const reply = screen.queryByRole("button", { name: "Reply" });
  const back = screen.queryByRole("button", { name: "Back to input" });
  if (reply) await user.click(reply);
  else if (back) await user.click(back);
}

async function openMore(user: ReturnType<typeof userEvent.setup>) {
  await showInput(user);
  const plus = screen.getByRole("button", { name: "Add context" });
  if (screen.queryByRole("button", { name: "Choose project" })) return;
  if (plus.getAttribute("aria-expanded") === "true") await user.click(plus);
  await user.click(plus);
}

async function showProgress(user: ReturnType<typeof userEvent.setup>) {
  if (screen.queryByRole("textbox", { name: "Goal" })) return;
  await openMore(user);
  await user.click(screen.getByRole("button", { name: "Progress" }));
}

async function showNotes(user: ReturnType<typeof userEvent.setup>) {
  const summary = document.querySelector(".progress-notes > summary");
  if (summary && !summary.parentElement?.hasAttribute("open")) await user.click(summary);
}

describe("duck conversation", () => {
  it("shows dots then streamed text before completion, and ignores late chunks", async () => {
    let reply = (_text: string) => {};
    let finish = (_text: string) => {};
    ask.mockImplementation((args: { onReply: { onmessage: (text: string) => void } }) => {
      reply = args.onReply.onmessage;
      return new Promise<string>((resolve) => { finish = resolve; });
    });
    const user = await openDuck();
    expect(screen.getByRole("button", { name: "Add context" }).textContent).toBe("+");
    await user.type(screen.getByRole("textbox", { name: "Your input" }), "Explain a loop{Enter}");
    expect(screen.getByRole("status", { name: "Thinking" }).textContent).toBe("…");
    expect(screen.queryByRole("textbox", { name: "Your input" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Model" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Mode" })).toBeNull();
    act(() => reply("A loop"));
    expect(screen.queryByRole("status", { name: "Thinking" })).toBeNull();
    expect(screen.getByLabelText("Current reply").textContent).toBe("A loop");
    act(() => reply("A loop repeats."));
    expect(screen.getByLabelText("Current reply").textContent).toBe("A loop repeats.");
    await act(async () => finish("A loop repeats."));
    expect(screen.queryByLabelText("Current reply")).toBeNull();
    act(() => reply("Late output"));
    expect(screen.queryByText("Late output")).toBeNull();
    expect(screen.getAllByText("A loop repeats.")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.getByRole("textbox", { name: "Your input" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Model" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Mode" })).toBeTruthy();
    expect(screen.queryByText("A loop repeats.")).toBeNull();
  });
  it("keeps chat simple and restores controls when a project chooser is cancelled", async () => {
    let cancelPicker: (value: null) => void = () => { throw new Error("Picker was not opened"); };
    chooseProject.mockImplementation(() => new Promise<null>((resolve) => { cancelPicker = resolve; }));
    const user = await openDuck();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Goal" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Mode" })).toBeTruthy();
    await openMore(user);
    await user.click(screen.getByRole("button", { name: "Choose project" }));
    expect(await screen.findByText("Choose or cancel a folder in the open dialog.")).toBeTruthy();
    await act(async () => cancelPicker(null));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Your input" }).disabled).toBe(false);
    await openMore(user);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Choose project" }).disabled).toBe(false);
  });
  it("does not carry an unfinished pasted selection into a different project", async () => {
    chooseProject.mockResolvedValueOnce({ root: "C:/projects/other", name: "other" });
    const user = await openDuck();
    await user.click(screen.getByRole("button", { name: "Add context" }));
    await user.click(screen.getByRole("button", { name: "Paste code" }));
    await user.type(screen.getByRole("textbox", { name: "Code selection" }), "Private to project A");
    await openMore(user);
    await user.click(screen.getByRole("button", { name: "Choose project" }));
    await openMore(user);
    expect(screen.getByRole("button", { name: "Choose project" }).textContent).toContain("other");
    expect(screen.queryByRole("textbox", { name: "Code selection" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Attach" })).toBeNull();
  });
  it("reviews a suggested plan before adoption and restores user progress after reopening", async () => {
    ask.mockResolvedValueOnce("- [ ] Define login behavior\n- [x] Validate empty passwords").mockResolvedValueOnce("What should an empty password do?");
    const user = await openDuck();
    await showProgress(user);
    await user.type(screen.getByRole("textbox", { name: "Goal" }), "Add login");
    await showInput(user);
    await user.type(screen.getByRole("textbox", { name: "Your input" }), "Help me plan login");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    await user.click(await screen.findByRole("button", { name: "Review suggested plan" }));
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Use plan" }));
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Mark step 1 complete" }).checked).toBe(false);
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Mark step 2 complete" }).checked).toBe(false);
    await user.click(screen.getByRole("checkbox", { name: "Mark step 1 complete" }));
    await showNotes(user);
    await user.type(screen.getByRole("textbox", { name: "Notes and attempts" }), "Blank password failed");
    await user.click(screen.getByRole("button", { name: "Discuss step 2" }));
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    await screen.findByText("What should an empty password do?");
    expect(invoke).toHaveBeenCalledWith("duck_ask", expect.objectContaining({ mode: "build", project: project.root, message: expect.stringContaining('"checkedByLearner":true') }));
    expect(invoke).toHaveBeenCalledWith("duck_ask", expect.objectContaining({ message: expect.stringContaining("Blank password failed") }));
    cleanup();
    const reopened = await openDuck();
    await showProgress(reopened);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Goal" }).value).toBe("Add login");
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Mark step 1 complete" }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Step 2" }).value).toBe("Validate empty passwords");
    await showNotes(reopened);
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Notes and attempts" }).value).toBe("Blank password failed");
  }, 15_000);

  it("keeps each project's goal, draft, and mode separate", async () => {
    chooseProject.mockResolvedValueOnce({ root: "C:/projects/other", name: "other" }).mockResolvedValueOnce(project);
    const user = await openDuck();
    await showProgress(user);
    await user.type(screen.getByRole("textbox", { name: "Goal" }), "Goal A");
    await showInput(user);
    await user.type(screen.getByRole("textbox", { name: "Your input" }), "Draft A");
    await openMore(user);
    await user.click(screen.getByRole("button", { name: "Choose project" }));
    await openMore(user);
    expect(screen.getByRole("button", { name: "Choose project" }).textContent).toContain("other");
    await showProgress(user);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Goal" }).value).toBe("");
    await showInput(user);
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Your input" }).value).toBe("");
    await user.selectOptions(screen.getByRole("combobox", { name: "Mode" }), "ideate");
    await showProgress(user);
    await user.type(screen.getByRole("textbox", { name: "Goal" }), "Goal B");
    await openMore(user);
    await user.click(screen.getByRole("button", { name: "Choose project" }));
    await openMore(user);
    expect(screen.getByRole("button", { name: "Choose project" }).textContent).toContain("example");
    await showProgress(user);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Goal" }).value).toBe("Goal A");
    await showInput(user);
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Your input" }).value).toBe("Draft A");
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Mode" }).value).toBe("build");
  });

  it("sends the selected mode and explicit pasted error as context", async () => {
    ask.mockResolvedValue("What input triggers that error?");
    const user = await openDuck();
    await user.selectOptions(screen.getByRole("combobox", { name: "Mode" }), "debug");
    await user.click(screen.getByRole("button", { name: "Add context" }));
    await user.click(screen.getByRole("button", { name: "Paste error" }));
    await user.type(screen.getByRole("textbox", { name: "Error output" }), "TypeError: missing user");
    await user.click(screen.getByRole("button", { name: "Attach" }));
    await user.type(screen.getByRole("textbox", { name: "Your input" }), "What can I check?");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    await screen.findByText("What input triggers that error?");
    expect(invoke).toHaveBeenCalledWith("duck_ask", expect.objectContaining({ mode: "debug", project: project.root, message: expect.stringContaining("TypeError: missing user") }));
    expect(JSON.parse(localStorage.getItem(`rubber-duck.session.v1:${project.root}`) ?? "null").turns[0].attachments[0].text).toBe("TypeError: missing user");
    expect(screen.queryByRole("button", { name: "Remove Pasted error" })).toBeNull();
  });

  it("attaches a selected project file and disables project changes while asking", async () => {
    attachFile.mockResolvedValue({ path: "src/login.ts", text: "const enabled = false;" });
    let finish: (reply: string) => void = () => { throw new Error("Request was not started"); };
    ask.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const user = await openDuck();
    await user.click(screen.getByRole("button", { name: "Add context" }));
    await user.click(screen.getByRole("button", { name: "Project file" }));
    await screen.findByText("src/login.ts");
    expect(invoke).toHaveBeenCalledWith("duck_attach_file", { project: project.root, path: null });
    await user.type(screen.getByRole("textbox", { name: "Your input" }), "Explain this file");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    expect(screen.queryByRole("button", { name: "Choose project" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Mode" })).toBeNull();
    expect(invoke).toHaveBeenCalledWith("duck_ask", expect.objectContaining({ message: expect.stringContaining("const enabled = false;") }));
    await act(async () => finish("What would you expect enabled to control?"));
  });

  it("does not overwrite corrupt saved progress while the learner types", async () => {
    const key = `rubber-duck.session.v1:${project.root}`;
    localStorage.setItem(key, "broken JSON");
    const user = await openDuck();
    expect(await screen.findByText(/Saved progress could not be restored/)).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Your input" }), "Keep this draft");
    expect(localStorage.getItem(key)).toBe("broken JSON");
    await user.click(screen.getByRole("button", { name: "Start fresh" }));
    expect(JSON.parse(localStorage.getItem(key) ?? "null")).toMatchObject({ mode: "build", goal: "", draft: "" });
  });

  it("blocks requests when the launching IDE cannot be detected", async () => {
    modelList.mockRejectedValueOnce("Could not detect your IDE.");
    const user = await openDuck();
    expect((await screen.findByRole("alert")).textContent).toContain("Could not detect your IDE.");
    await user.type(screen.getByRole("textbox", { name: "Your input" }), "Explain loops");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Ask the duck" }).disabled).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("offers only the IDE default if discovery fails without inventing other models", async () => {
    modelList.mockResolvedValueOnce({ ide: "claude", models: [], warning: "Model list unavailable. Using your IDE's default." });
    await openDuck();
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Model" }).title).toBe("Claude Code");
    expect(within(screen.getByRole("combobox", { name: "Model" })).getAllByRole("option").map((option) => option.textContent)).toEqual(["CLI default"]);
    expect(screen.getByText("Model list unavailable. Using your IDE's default.")).toBeTruthy();
  });

  it("keeps every model family available through Cursor", async () => {
    modelList.mockResolvedValueOnce({ ide: "cursor", models: [{ id: "gpt-example", label: "GPT Example" }, { id: "claude-example", label: "Claude Example" }, { id: "composer-example", label: "Composer Example" }], warning: null });
    await openDuck();
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Model" }).title).toBe("Cursor");
    expect(within(screen.getByRole("combobox", { name: "Model" })).getAllByRole("option").map((option) => option.textContent)).toEqual(["GPT Example", "Claude Example", "Composer Example"]);
  });

  it("only offers the current IDE's models and locks selection while answering", async () => {
    let finish: (reply: string) => void = () => { throw new Error("Request was not started"); };
    ask.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const user = await openDuck();
    const picker = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Model" });
    expect(within(screen.getByRole("combobox", { name: "Model" })).getAllByRole("option").map((option) => option.textContent)).toEqual(["GPT Example A", "GPT Example B"]);
    expect(screen.queryByRole("option", { name: "Claude Code" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Cursor" })).toBeNull();
    await user.selectOptions(picker, "gpt-example-b");
    await user.type(screen.getByRole("textbox", { name: "Your input" }), "Explain loops");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    expect(invoke).toHaveBeenCalledWith("duck_ask", expect.objectContaining({ model: "gpt-example-b", mode: "build", project: project.root, message: expect.stringContaining("Explain loops") }));
    expect(screen.queryByRole("combobox", { name: "Model" })).toBeNull();
    await act(async () => finish("A loop repeats a step."));
    await showInput(user);
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Model" }).value).toBe("gpt-example-b");
  });

  it("opens and hides the panel with the keyboard", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("textbox", { name: "Your input" })).toBeTruthy();
    await user.keyboard(" ");
    expect(screen.queryByRole("textbox", { name: "Your input" })).toBeNull();
  });

  it("stops a request, keeps the draft, and ignores a reply arriving during Stop", async () => {
    let finish: (reply: string) => void = () => { throw new Error("Request was not started"); };
    ask.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const user = await openDuck();
    await user.type(screen.getByRole("textbox", { name: "Your input" }), "Explain this error");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(invoke).toHaveBeenLastCalledWith("duck_cancel", expect.objectContaining({ requestId: expect.any(Number) }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Stop" }).disabled).toBe(true);
    await act(async () => finish("A stale reply"));
    expect(screen.queryByText("A stale reply")).toBeNull();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Your input" }).value).toBe("Explain this error");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Ask the duck" }).disabled).toBe(false);
  });

  it("keeps the question available after a timeout", async () => {
    ask.mockRejectedValue("Request timed out. Try again or ask a shorter question.");
    const user = await openDuck();
    await user.type(screen.getByRole("textbox", { name: "Your input" }), "Explain this error");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Request timed out. Try again or ask a shorter question.");
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Your input" }).value).toBe("Explain this error");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Ask the duck" }).disabled).toBe(false);
  });

  it("keeps a draft when the panel is hidden and reopened", async () => {
    const user = await openDuck();
    await user.type(screen.getByRole("textbox", { name: "Your input" }), "Why does this loop stop?");
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Your input" }).value).toBe("Why does this loop stop?");
  });

  it("keeps replies and includes them in a follow-up", async () => {
    ask.mockResolvedValueOnce("What is the loop condition?").mockResolvedValueOnce("Trace the first iteration.");
    const user = await openDuck();
    await user.type(screen.getByRole("textbox", { name: "Your input" }), "My loop stops early");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    await screen.findByText("What is the loop condition?");
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    expect(screen.getByText("What is the loop condition?")).toBeTruthy();
    await showInput(user);
    await user.type(screen.getByRole("textbox", { name: "Your input" }), "It checks i < 3");
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
    await user.type(screen.getByRole("textbox", { name: "Your input" }), "Explain this error");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    await user.click(screen.getByRole("button", { name: /Rubber duck:/ }));
    expect(screen.getByRole("status", { name: "Thinking" })).toBeTruthy();
    expect(ask.mock.calls).toHaveLength(1);
    await act(async () => finish("What changed before the error?"));
    expect(await screen.findByText("What changed before the error?")).toBeTruthy();
  });

  it("only clears the conversation when New chat is pressed", async () => {
    ask.mockResolvedValue("What have you tried?");
    const user = await openDuck();
    await user.type(screen.getByRole("textbox", { name: "Your input" }), "I am stuck");
    await user.click(screen.getByRole("button", { name: "Ask the duck" }));
    await screen.findByText("What have you tried?");
    await openMore(user);
    await user.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.queryByText("What have you tried?")).toBeNull();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Your input" }).value).toBe("");
  });
});
