import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SpeechBubble, type ChatTurn } from "./SpeechBubble";
import "./App.css";

const DUCK_DRAG_THRESHOLD = 8;

const BUBBLE_HINT =
  "Ask a concept (e.g. “What is debugging?”) or, if you’re stuck on a bug, one line: what you expected vs what happened.";

type RequestStatus =
  | { kind: "idle" }
  | { kind: "running" | "stopping"; id: number; startedAt: number };

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
}

export default function App() {
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<RequestStatus>({ kind: "idle" });
  const requestRef = useRef<RequestStatus>(request);
  const nextRequestId = useRef(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const busy = request.kind !== "idle";
  const duckDragRef = useRef<{ x: number; y: number; armed: boolean } | null>(
    null,
  );

  const beginWindowDrag = useCallback(() => {
    void getCurrentWindow().startDragging();
  }, []);

  const onAsk = useCallback(async () => {
    const text = draft.trim();
    if (!text || requestRef.current.kind !== "idle") return;
    const id = ++nextRequestId.current;
    const pending: RequestStatus = { kind: "running", id, startedAt: Date.now() };
    requestRef.current = pending;
    setRequest(pending);
    setError(null);
    setNotice(null);
    try {
      const message = turns.length
        ? `Previous conversation (JSON):\n${JSON.stringify(turns)}\n\nCurrent question:\n${text}`
        : text;
      const out = await invoke<string>("duck_ask", { message, requestId: id });
      if (requestRef.current.kind === "running") {
        setTurns((previous) => [...previous, { question: text, answer: out }]);
        setDraft("");
      }
    } catch (e) {
      if (requestRef.current.kind !== "stopping") setError(errorMessage(e));
    } finally {
      if (requestRef.current.kind === "stopping") setNotice("Stopped. Your question is still here.");
      requestRef.current = { kind: "idle" };
      setRequest({ kind: "idle" });
    }
  }, [draft, turns]);

  const onStop = useCallback(async () => {
    const current = requestRef.current;
    if (current.kind !== "running") return;
    const stopping: RequestStatus = { ...current, kind: "stopping" };
    requestRef.current = stopping;
    setRequest(stopping);
    try {
      await invoke("duck_cancel", { requestId: current.id });
    } catch (e) {
      if (requestRef.current === stopping) {
        requestRef.current = current;
        setRequest(current);
        setError(errorMessage(e));
      }
    }
  }, []);

  const onNewChat = useCallback(() => {
    if (requestRef.current.kind !== "idle") return;
    setTurns([]);
    setDraft("");
    setError(null);
    setNotice(null);
  }, []);

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
              stopping={request.kind === "stopping"}
              startedAt={request.kind === "idle" ? null : request.startedAt}
              onStop={onStop}
              notice={notice}
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
          onClick={(event) => {
            if (event.detail === 0) setBubbleOpen((open) => !open);
          }}
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
