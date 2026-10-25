import { useEffect, useState } from "react";
import { ChatTranscript } from "./ChatTranscript";
import { ContextComposer } from "./ContextComposer";
import { PlanPanel, type PlanSuggestion } from "./PlanPanel";
import { type TutorMode, type TutorSession } from "./tutor";
import type { Workspace } from "./useTutorWorkspace";

export interface ModelCatalog {
  ide: "codex" | "claude" | "cursor";
  models: { id: string; label: string }[];
  warning: string | null;
}
export type CatalogState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; catalog: ModelCatalog };
const IDE_LABELS = { codex: "Codex", claude: "Claude Code", cursor: "Cursor" };

interface Props {
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
  startedAt: number | null;
  onStop: () => void;
  notice: string | null;
  onNewChat: () => void;
  error: string | null;
}

export function SpeechBubble({ catalog, model, onModelChange, onRefreshModels, workspace, onSessionChange, onChooseProject, onAttachFile, onHide, locked, picking, storageError, onStartFresh, onAsk, busy, streamedReply, stopping, onStop, notice, onNewChat, error }: Props) {
  const [progressOpen, setProgressOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<PlanSuggestion | null>(null);
  const projectRoot = workspace.kind === "ready" ? workspace.project.root : null;
  useEffect(() => { setProgressOpen(false); setSuggestion(null); }, [projectRoot]);
  const selectedModel = catalog.kind === "ready" ? catalog.catalog.models.find((entry) => entry.id === model)?.label ?? "CLI default" : "Models";

  return <div className="speech-bubble no-drag" role="region" aria-label="Rubber duck tutor">
    <div className="speech-bubble-inner">
      <header className="tutor-header">
        <button type="button" className="project-picker" disabled={locked || workspace.kind === "loading"} onClick={onChooseProject} title={workspace.kind === "ready" ? workspace.project.root : "Choose a project folder"} aria-label="Choose project">
          <strong>{workspace.kind === "ready" ? workspace.project.name : workspace.kind === "loading" ? "Opening project..." : "Choose folder"}</strong>
        </button>
        <button type="button" className="hide-panel" aria-label="Hide" title="Hide" onClick={onHide}>×</button>
      </header>
      {picking && <p className="picker-notice" role="status">{picking === "project" ? "Choose or cancel a folder in the open dialog." : "Choose or cancel a file in the open dialog."}</p>}
      {workspace.kind === "error" && <p className="speech-bubble-error" role="alert">{workspace.message}</p>}
      <details className="model-settings">
        <summary>{catalog.kind === "ready" ? IDE_LABELS[catalog.catalog.ide] : "Current IDE"} · {selectedModel}</summary>
        <div className="agent-picker">
          <label htmlFor="duck-model">Model</label>
          {catalog.kind === "ready" && <select id="duck-model" value={model} disabled={locked} onChange={(event) => {
            const value = event.target.value;
            if (catalog.catalog.models.some((entry) => entry.id === value)) onModelChange(value);
          }}>
            {catalog.catalog.models.length === 0 && <option value="">CLI default</option>}
            {catalog.catalog.models.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>}
          <button type="button" className="refresh-models" disabled={locked || catalog.kind === "loading" || workspace.kind !== "ready"} onClick={onRefreshModels} aria-label="Refresh models">Reload</button>
        </div>
        {catalog.kind === "ready" && catalog.catalog.warning && <p className="model-notice">{catalog.catalog.warning}</p>}
      </details>
      {catalog.kind === "loading" && workspace.kind === "ready" && <p className="model-notice" aria-live="polite">Loading your IDE's models...</p>}
      {catalog.kind === "error" && <p className="speech-bubble-error" role="alert">{catalog.message}</p>}
      {workspace.kind === "ready" && <>
        <div className="tutor-toolbar">
          <select id="tutor-mode" aria-label="Mode" value={workspace.session.mode} disabled={locked} onChange={(event) => {
            const mode = event.target.value;
            if (mode === "ideate" || mode === "build" || mode === "debug") onSessionChange((previous) => ({ ...previous, mode }));
            setProgressOpen(false);
          }}>
            {(["ideate", "build", "debug"] satisfies TutorMode[]).map((mode) => <option key={mode} value={mode}>{mode[0].toUpperCase() + mode.slice(1)}</option>)}
          </select>
          <button type="button" className="progress-toggle" aria-expanded={progressOpen} onClick={() => setProgressOpen(!progressOpen)}>{progressOpen ? "← Chat" : `Progress${workspace.session.steps.length ? ` (${workspace.session.steps.filter((step) => step.done).length}/${workspace.session.steps.length})` : ""}`}</button>
          <button type="button" className="new-chat" aria-label="New chat" title="New chat" disabled={locked || (!workspace.session.turns.length && !workspace.session.draft && !workspace.session.attachments.length && !error)} onClick={onNewChat}>↗</button>
        </div>
        <main className="tutor-content" aria-label={progressOpen ? "Learning progress" : "Chat"}>
          {!progressOpen && <ChatTranscript turns={workspace.session.turns} locked={locked} pending={busy ? { question: workspace.session.draft.trim(), answer: streamedReply } : null} onReviewPlan={(plan) => { setSuggestion(plan); setProgressOpen(true); }} />}
          {progressOpen && <>
            <label className="goal-field" htmlFor="learning-goal">Goal
              <input id="learning-goal" value={workspace.session.goal} maxLength={240} disabled={locked} placeholder="What are you working toward?" onChange={(event) => onSessionChange((previous) => ({ ...previous, goal: event.target.value }))} />
            </label>
            <PlanPanel session={workspace.session} locked={locked} suggestion={suggestion} onChange={onSessionChange} onDismissSuggestion={() => setSuggestion(null)} onDiscuss={(step) => {
              onSessionChange((previous) => ({ ...previous, mode: "build", draft: `${previous.draft ? `${previous.draft}\n\n` : ""}Help me with this step: ${step}`.slice(0, 12_000) })); setProgressOpen(false);
            }} />
            <details className="progress-notes"><summary>Notes and attempts</summary><div className="notes-panel"><label htmlFor="learning-notes">Notes and attempts</label><textarea id="learning-notes" value={workspace.session.notes} maxLength={12_000} disabled={locked} rows={4} placeholder="What have you tried? What happened?" onChange={(event) => onSessionChange((previous) => ({ ...previous, notes: event.target.value }))} /></div></details>
          </>}
        </main>
        <div className="tutor-composer">
          <ContextComposer key={workspace.project.root} session={workspace.session} locked={locked} onAttachFile={onAttachFile} onChange={onSessionChange} />
          <textarea id="duck-input" aria-label="Your input" className="speech-bubble-input" rows={2} maxLength={12_000} value={busy ? "" : workspace.session.draft} placeholder="Ask anything" disabled={locked} onChange={(event) => onSessionChange((previous) => ({ ...previous, draft: event.target.value }))} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!locked && catalog.kind === "ready" && workspace.session.draft.trim()) { setProgressOpen(false); onAsk(); }
            }
          }} spellCheck />
          <div className="speech-bubble-actions">
            {busy ? <button type="button" className="speech-bubble-ask" aria-label="Stop" title="Stop" disabled={stopping} onClick={onStop}>■</button>
              : <button type="button" className="speech-bubble-ask" aria-label="Ask the duck" title="Send" disabled={locked || catalog.kind !== "ready" || !workspace.session.draft.trim()} onClick={() => { setProgressOpen(false); onAsk(); }}>↑</button>}
          </div>
        </div>
      </>}
      {notice && <p className="speech-bubble-status" role="status">{notice}</p>}
      {error && <pre className="speech-bubble-error" role="alert">{error}</pre>}
      {storageError && <div className="save-error" role="alert">{storageError}<button type="button" disabled={locked} onClick={onStartFresh}>Start fresh</button></div>}
    </div>
  </div>;
}
