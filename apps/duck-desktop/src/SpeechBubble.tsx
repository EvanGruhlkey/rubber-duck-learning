import { useEffect, useRef, useState } from "react";
import { ChatTranscript } from "./ChatTranscript";
import { ContextComposer } from "./ContextComposer";
import { PlanPanel, type PlanSuggestion } from "./PlanPanel";
import { type TutorMode, type TutorSession } from "./tutor";
import type { PanelView } from "./panel";
import type { Workspace } from "./useTutorWorkspace";

export interface ModelCatalog {
  ide: "codex" | "claude" | "cursor";
  models: { id: string; label: string }[];
  warning: string | null;
}
export type CatalogState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; catalog: ModelCatalog };
const IDE_LABELS = { codex: "Codex", claude: "Claude Code", cursor: "Cursor" };

interface Props {
  view: PanelView;
  onViewChange: (view: PanelView) => void;
  onOutputHeight: (height: number) => void;
  catalog: CatalogState;
  model: string;
  onModelChange: (model: string) => void;
  onRefreshModels: () => void;
  workspace: Workspace;
  onSessionChange: (update: (session: TutorSession) => TutorSession) => void;
  onChooseProject: () => void;
  onAttachFile: () => void;
  onHide: () => void;
  locked: boolean;
  picking: "project" | "file" | null;
  storageError: string | null;
  onStartFresh: () => void;
  onAsk: () => void;
  busy: boolean;
  streamedReply: string;
  stopping: boolean;
  onStop: () => void;
  notice: string | null;
  onNewChat: () => void;
  error: string | null;
}

export function SpeechBubble({ view, onViewChange, onOutputHeight, catalog, model, onModelChange, onRefreshModels, workspace, onSessionChange, onChooseProject, onAttachFile, onHide, locked, picking, storageError, onStartFresh, onAsk, busy, streamedReply, stopping, onStop, notice, onNewChat, error }: Props) {
  const [suggestion, setSuggestion] = useState<PlanSuggestion | null>(null);
  const outputRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const container = outputRef.current;
    const content = container?.firstElementChild;
    if (view !== "output" || !container || !content || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (!container.clientHeight) return;
      const chrome = window.innerHeight - container.clientHeight;
      onOutputHeight(Math.max(260, Math.min(620, Math.ceil(content.scrollHeight + chrome))));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [view, onOutputHeight]);
  const projectRoot = workspace.kind === "ready" ? workspace.project.root : null;
  useEffect(() => { setSuggestion(null); }, [projectRoot]);
  const submit = () => {
    if (!locked && catalog.kind === "ready" && workspace.kind === "ready" && workspace.session.draft.trim()) onAsk();
  };

  return <div className={`speech-bubble no-drag view-${view}`} role="region" aria-label="Rubber duck tutor">
    <div className="speech-bubble-inner">
      <button type="button" className="hide-panel" aria-label="Hide" title="Hide" onClick={onHide}>×</button>
      {picking && <p className="picker-notice" role="status">{picking === "project" ? "Choose or cancel a folder in the open dialog." : "Choose or cancel a file in the open dialog."}</p>}
      {workspace.kind === "error" && <><p className="speech-bubble-error" role="alert">{workspace.message}</p><button type="button" disabled={locked} onClick={onChooseProject}>Choose folder</button></>}
      {catalog.kind === "error" && <p className="speech-bubble-error" role="alert">{catalog.message}<button type="button" onClick={onRefreshModels}>Retry</button></p>}
      {workspace.kind === "ready" && <>
        {view === "compose" && <>
          <div className="composer-options">
            <select id="duck-model" aria-label="Model" title={catalog.kind === "ready" ? IDE_LABELS[catalog.catalog.ide] : "Model"} value={model} disabled={locked || catalog.kind !== "ready"} onChange={(event) => {
              const value = event.target.value;
              if (catalog.kind === "ready" && catalog.catalog.models.some((entry) => entry.id === value)) onModelChange(value);
            }}>
              {catalog.kind !== "ready" ? <option value="">…</option> : catalog.catalog.models.length === 0 ? <option value="">CLI default</option> : catalog.catalog.models.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
            <select id="tutor-mode" aria-label="Mode" value={workspace.session.mode} disabled={locked} onChange={(event) => {
              const mode = event.target.value;
              if (mode === "ideate" || mode === "build" || mode === "debug") onSessionChange((previous) => ({ ...previous, mode }));
            }}>
              {(["ideate", "build", "debug"] satisfies TutorMode[]).map((mode) => <option key={mode} value={mode}>{mode[0].toUpperCase() + mode.slice(1)}</option>)}
            </select>
          </div>
          <div className="tutor-composer">
            <ContextComposer key={workspace.project.root} session={workspace.session} locked={locked} onAttachFile={onAttachFile} onChange={onSessionChange}>
              <button type="button" aria-label="Choose project" title={workspace.project.root} disabled={locked} onClick={onChooseProject}>{workspace.project.name} · Folder</button>
              <button type="button" disabled={locked} onClick={() => onViewChange("progress")}>Progress</button>
              {workspace.session.turns.length > 0 && <button type="button" onClick={() => onViewChange("output")}>Last reply</button>}
              <button type="button" disabled={locked} onClick={onNewChat}>New chat</button>
              <button type="button" disabled={locked || catalog.kind === "loading"} onClick={onRefreshModels} aria-label="Refresh models">Reload models</button>
            </ContextComposer>
            <textarea id="duck-input" aria-label="Your input" className="speech-bubble-input" rows={3} maxLength={12_000} value={workspace.session.draft} placeholder="Ask anything" disabled={locked} onChange={(event) => onSessionChange((previous) => ({ ...previous, draft: event.target.value }))} onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
            }} spellCheck />
            <div className="speech-bubble-actions"><button type="button" className="speech-bubble-ask" aria-label="Ask the duck" title="Send" disabled={locked || catalog.kind !== "ready" || !workspace.session.draft.trim()} onClick={submit}>↑</button></div>
          </div>
          {catalog.kind === "ready" && catalog.catalog.warning && <p className="model-notice">{catalog.catalog.warning}</p>}
        </>}
        {view === "output" && <>
          <main className="tutor-content" aria-label="Duck reply" ref={outputRef}>
            <ChatTranscript turns={workspace.session.turns} locked={locked} pending={busy ? { question: workspace.session.draft.trim(), answer: streamedReply } : null} onReviewPlan={(plan) => { setSuggestion(plan); onViewChange("progress"); }} />
          </main>
          <div className="output-actions">{busy
            ? <button type="button" className="reply-button" aria-label="Stop" title="Stop" disabled={stopping} onClick={onStop}>■</button>
            : <button type="button" className="reply-button" aria-label="Reply" title="Reply" onClick={() => onViewChange("compose")}>↩</button>}
          </div>
        </>}
        {view === "progress" && <>
          <button type="button" className="progress-back" aria-label="Back to input" onClick={() => onViewChange("compose")}>←</button>
          <main className="tutor-content" aria-label="Learning progress">
            <label className="goal-field" htmlFor="learning-goal">Goal<input id="learning-goal" value={workspace.session.goal} maxLength={240} disabled={locked} placeholder="What are you working toward?" onChange={(event) => onSessionChange((previous) => ({ ...previous, goal: event.target.value }))} /></label>
            <PlanPanel session={workspace.session} locked={locked} suggestion={suggestion} onChange={onSessionChange} onDismissSuggestion={() => setSuggestion(null)} onDiscuss={(step) => {
              onSessionChange((previous) => ({ ...previous, mode: "build", draft: `${previous.draft ? `${previous.draft}\n\n` : ""}Help me with this step: ${step}`.slice(0, 12_000) })); onViewChange("compose");
            }} />
            <details className="progress-notes"><summary>Notes and attempts</summary><div className="notes-panel"><label htmlFor="learning-notes">Notes and attempts</label><textarea id="learning-notes" value={workspace.session.notes} maxLength={12_000} disabled={locked} rows={4} placeholder="What have you tried?" onChange={(event) => onSessionChange((previous) => ({ ...previous, notes: event.target.value }))} /></div></details>
          </main>
        </>}
      </>}
      {notice && <p className="speech-bubble-status" role="status">{notice}</p>}
      {error && <pre className="speech-bubble-error" role="alert">{error}</pre>}
      {storageError && <div className="save-error" role="alert">{storageError}<button type="button" disabled={locked} onClick={onStartFresh}>Start fresh</button></div>}
    </div>
  </div>;
}
