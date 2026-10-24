import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SpeechBubble, type ChatTurn } from "./SpeechBubble";
import "./App.css";

const DUCK_DRAG_THRESHOLD = 8;

const BUBBLE_HINT =
  "Ask a concept (e.g. “What is debugging?”) or, if you’re stuck on a bug, one line: what you expected vs what happened.";

export default function App() {
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const duckDragRef = useRef<{ x: number; y: number; armed: boolean } | null>(
    null,
  );

  const beginWindowDrag = useCallback(() => {
    void getCurrentWindow().startDragging();
  }, []);

  const onAsk = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const message = turns.length
        ? `Previous conversation (JSON):\n${JSON.stringify(turns)}\n\nCurrent question:\n${text}`
        : text;
      const out = await invoke<string>("duck_ask", { message });
      setTurns((previous) => [...previous, { question: text, answer: out }]);
      setDraft("");
    } catch (e) {
      let msg: string;
      if (typeof e === "string") msg = e;
      else if (e && typeof e === "object" && "message" in e)
        msg = String(e.message);
      else msg = String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [busy, draft, turns]);

  const onNewChat = useCallback(() => {
    if (busy) return;
    setTurns([]);
    setDraft("");
    setError(null);
  }, [busy]);

  const onRootPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".no-drag")) return;
      beginWindowDrag();
    },
    [beginWindowDrag],
  );

  const onDuckPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    duckDragRef.current = {
      x: e.clientX,
      y: e.clientY,
      armed: true,
    };
    (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
  }, []);

  const onDuckPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const s = duckDragRef.current;
      if (!s?.armed) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (dx * dx + dy * dy < DUCK_DRAG_THRESHOLD * DUCK_DRAG_THRESHOLD) return;
      s.armed = false;
      duckDragRef.current = null;
      try {
        (e.currentTarget as HTMLButtonElement).releasePointerCapture(
          e.pointerId,
        );
      } catch {
        /* ignore */
      }
      beginWindowDrag();
    },
    [beginWindowDrag],
  );

  const onDuckPointerUp = useCallback((e: React.PointerEvent) => {
    const wasTap = duckDragRef.current?.armed === true;
    duckDragRef.current = null;
    try {
      (e.currentTarget as HTMLButtonElement).releasePointerCapture(
        e.pointerId,
      );
    } catch {
      /* ignore */
    }
    if (wasTap) setBubbleOpen((open) => !open);
  }, []);

  const onDuckPointerCancel = useCallback((e: React.PointerEvent) => {
    duckDragRef.current = null;
    try {
      (e.currentTarget as HTMLButtonElement).releasePointerCapture(
        e.pointerId,
      );
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="root" onPointerDown={onRootPointerDown}>
      <div className="stage">
        <div className="stage-bubble-slot">
          {bubbleOpen && (
            <SpeechBubble
              message={BUBBLE_HINT}
              inputValue={draft}
              onInputChange={setDraft}
              onAsk={onAsk}
              busy={busy}
              turns={turns}
              onNewChat={onNewChat}
              error={error}
            />
          )}
        </div>
        <button
          type="button"
          className="duck-hit no-drag"
          onPointerDown={onDuckPointerDown}
          onPointerMove={onDuckPointerMove}
          onPointerUp={onDuckPointerUp}
          onPointerCancel={onDuckPointerCancel}
          aria-expanded={bubbleOpen}
          aria-label={
            bubbleOpen
              ? "Rubber duck: tap to hide panel, or drag to move window"
              : "Rubber duck: tap for panel, or drag to move window"
          }
        >
          <img className="duck-img" src="/duck.svg" alt="Rubber duck" />
        </button>
      </div>
    </div>
  );
}
