import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useRef, useState } from "react";

export interface ChatTurn {
  question: string;
  answer: string;
}

export interface ModelCatalog {
  ide: "codex" | "claude" | "cursor";
  models: { id: string; label: string }[];
  warning: string | null;
}

export type CatalogState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; catalog: ModelCatalog };

const IDE_LABELS = { codex: "Codex", claude: "Claude Code", cursor: "Cursor" };

interface SpeechBubbleProps {
  catalog: CatalogState;
  model: string;
  onModelChange: (model: string) => void;
  onRefreshModels: () => void;
  message: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  inputPlaceholder?: string;
  onAsk: () => void;
  busy: boolean;
  stopping: boolean;
  startedAt: number | null;
  onStop: () => void;
  notice: string | null;
  turns: ChatTurn[];
  onNewChat: () => void;
  error: string | null;
}

/** Soft card + tail; hint, input, Ask, and reply area. */
export function SpeechBubble({
  catalog,
  model,
  onModelChange,
  onRefreshModels,
  message,
  inputValue,
  onInputChange,
  inputPlaceholder = "Describe the bug, your theory, or paste an error…",
  onAsk,
  busy,
  stopping,
  startedAt,
  onStop,
  notice,
  turns,
  onNewChat,
  error,
}: SpeechBubbleProps) {
  const conversationRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [turns]);

  return (
    <div className="speech-bubble no-drag" role="region" aria-label="Rubber duck chat">
      <div className="speech-bubble-inner">
        <div className="ide-context">
          <span>{catalog.kind === "ready" ? IDE_LABELS[catalog.catalog.ide] : "Current IDE"}</span>
          <button type="button" className="refresh-models" disabled={busy || catalog.kind === "loading"} onClick={onRefreshModels} aria-label="Refresh models">Reload</button>
        </div>
        {catalog.kind === "loading" && <p className="model-notice" aria-live="polite">Loading your IDE's models...</p>}
        {catalog.kind === "error" && <p className="speech-bubble-error" role="alert">{catalog.message}</p>}
        {catalog.kind === "ready" && (
          <>
            <div className="agent-picker">
              <label htmlFor="duck-model">Model</label>
              <select id="duck-model" value={model} disabled={busy} onChange={(event) => {
                const value = event.target.value;
                if (value === "" || catalog.catalog.models.some((entry) => entry.id === value)) onModelChange(value);
              }}>
                {catalog.catalog.models.length === 0 && <option value="">CLI default</option>}
                {catalog.catalog.models.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </div>
            {catalog.catalog.warning && <p className="model-notice">{catalog.catalog.warning}</p>}
          </>
        )}
        {turns.length === 0 && <p className="speech-bubble-text">{message}</p>}
        {turns.length > 0 && (
          <div className="conversation" role="log" aria-label="Conversation" ref={conversationRef}>
            {turns.map((turn, index) => (
              <div className="conversation-turn" key={index}>
                <p className="speech-bubble-reply-label">You</p>
                <p className="conversation-question">{turn.question}</p>
                <p className="speech-bubble-reply-label">Duck</p>
                <div className="speech-bubble-reply markdown-reply">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children, ...rest }) => (
                        <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {turn.answer}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
          </div>
        )}
        <label className="speech-bubble-label" htmlFor="duck-input">
          Your input
        </label>
        <textarea
          id="duck-input"
          className="speech-bubble-input"
          rows={3}
          value={inputValue}
          placeholder={inputPlaceholder}
          onChange={(e) => onInputChange(e.target.value)}
          disabled={busy}
          spellCheck
        />
        <div className="speech-bubble-actions">
          <button
            type="button"
            className="speech-bubble-ask"
            disabled={busy || catalog.kind !== "ready" || !inputValue.trim()}
            onClick={onAsk}
          >
            {stopping ? "Stopping…" : busy ? "Thinking…" : "Ask the duck"}
          </button>
          {busy ? (
            <button type="button" className="speech-bubble-secondary" disabled={stopping} onClick={onStop}>Stop</button>
          ) : (
            <button type="button" className="speech-bubble-secondary" disabled={!turns.length && !inputValue && !error} onClick={onNewChat}>
              New chat
            </button>
          )}
        </div>
        <p className="speech-bubble-status" role="status">
          {startedAt !== null
            ? stopping ? "Stopping your local assistant..." : `Waiting for your local assistant. ${Math.max(0, Math.floor((now - startedAt) / 1000))}s of 120s.`
            : notice}
        </p>
        {error && (
          <pre className="speech-bubble-error" role="alert">
            {error}
          </pre>
        )}
      </div>
    </div>
  );
}
