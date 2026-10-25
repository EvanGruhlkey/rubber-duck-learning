import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SpeechBubble, type ModelCatalog, type CatalogState } from "./SpeechBubble";
import { composeMessage, createSession, replyForSession, type ChatTurn, type ContextAttachment } from "./tutor";
import { useTutorWorkspace } from "./useTutorWorkspace";
import { resizePanel } from "./panel";
import "./App.css";

const DUCK_DRAG_THRESHOLD = 8;

const EMPTY_SESSION = createSession();

type RequestStatus =
  | { kind: "idle" }
  | { kind: "running" | "stopping"; id: number; startedAt: number };

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
}

export default function App() {
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const { workspace, updateSession, chooseProject, startFresh, problem, storageError } = useTutorWorkspace();
  const session = workspace.kind === "ready" ? workspace.session : EMPTY_SESSION;
  const projectRoot = workspace.kind === "ready" ? workspace.project.root : null;
  const [picking, setPicking] = useState<"project" | "file" | null>(null);
  const [catalog, setCatalog] = useState<CatalogState>({ kind: "loading" });
  const [model, setModel] = useState("");
  const catalogGeneration = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<RequestStatus>({ kind: "idle" });
  const requestRef = useRef<RequestStatus>(request);
  const nextRequestId = useRef(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const busy = request.kind !== "idle";
  const locked = busy || picking !== null;

  useEffect(() => {
    void resizePanel(bubbleOpen).catch((error: unknown) => setError(`Could not resize the tutor panel: ${String(error)}`));
  }, [bubbleOpen]);

  const refreshModels = useCallback(async () => {
    if (requestRef.current.kind !== "idle" || projectRoot === null) return;
    const generation = ++catalogGeneration.current;
    setCatalog({ kind: "loading" });
    setModel("");
    try {
      const result = await invoke<ModelCatalog>("duck_models", { project: projectRoot });
      if (generation === catalogGeneration.current) {
        setModel(result.models[0]?.id ?? "");
        setCatalog({ kind: "ready", catalog: result });
      }
    } catch (error) {
      if (generation === catalogGeneration.current) setCatalog({ kind: "error", message: errorMessage(error) });
    }
  }, [projectRoot]);

  useEffect(() => {
    void refreshModels();
    return () => { catalogGeneration.current += 1; };
  }, [refreshModels]);
  const duckDragRef = useRef<{ x: number; y: number; armed: boolean } | null>(
    null,
  );

  const beginWindowDrag = useCallback(() => {
    void getCurrentWindow().startDragging();
  }, []);

  const onAsk = useCallback(async () => {
    const text = session.draft.trim();
    if (!text || requestRef.current.kind !== "idle" || picking !== null || projectRoot === null || catalog.kind !== "ready") return;
    const id = ++nextRequestId.current;
    const pending: RequestStatus = { kind: "running", id, startedAt: Date.now() };
    requestRef.current = pending;
    setRequest(pending);
    setError(null);
    setNotice(null);
    try {
      const message = composeMessage(session, text);
      const out = await invoke<string>("duck_ask", { message, model, mode: session.mode, project: projectRoot, requestId: id });
      if (requestRef.current.kind === "running" && requestRef.current.id === id) {
        const turn: ChatTurn = { id: crypto.randomUUID(), question: text, answer: replyForSession(out), mode: session.mode, attachments: session.attachments };
        updateSession((previous) => ({ ...previous, turns: [...previous.turns, turn].slice(-40), draft: "", attachments: [] }), projectRoot);
      }
    } catch (e) {
      if (requestRef.current.kind === "running" && requestRef.current.id === id) setError(errorMessage(e));
    } finally {
      if (!("id" in requestRef.current) || requestRef.current.id !== id) return;
      if (requestRef.current.kind === "stopping") setNotice("Stopped. Your question is still here.");
      requestRef.current = { kind: "idle" };
      setRequest({ kind: "idle" });
    }
  }, [session, picking, projectRoot, model, catalog, updateSession]);

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
    updateSession((previous) => ({ ...previous, turns: [], draft: "", attachments: [] }));
    setError(null);
    setNotice(null);
  }, [updateSession]);

  const onChooseProject = useCallback(async () => {
    if (requestRef.current.kind !== "idle" || picking !== null) return;
    setPicking("project");
    setError(null);
    setNotice(null);
    try { await chooseProject(); } finally { setPicking(null); }
  }, [chooseProject, picking]);

  const onAttachFile = useCallback(async () => {
    if (requestRef.current.kind !== "idle" || picking !== null || projectRoot === null || session.attachments.length >= 3) return;
    setPicking("file");
    try {
      const context = await invoke<{ path: string; text: string } | null>("duck_attach_file", { project: projectRoot, path: null });
      if (context) {
        const attachment: ContextAttachment = { id: crypto.randomUUID(), kind: "file", label: context.path, text: context.text };
        updateSession((previous) => ({ ...previous, attachments: [...previous.attachments, attachment].slice(0, 3) }), projectRoot);
      }
    } catch (error) { setError(errorMessage(error)); }
    finally { setPicking(null); }
  }, [picking, projectRoot, session.attachments.length, updateSession]);

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
              catalog={catalog}
              model={model}
              onModelChange={setModel}
              onRefreshModels={refreshModels}
              workspace={workspace}
              onSessionChange={updateSession}
              onChooseProject={onChooseProject}
              onAttachFile={onAttachFile}
              onHide={() => setBubbleOpen(false)}
              locked={locked}
              picking={picking}
              storageError={storageError}
              onStartFresh={startFresh}
              onAsk={onAsk}
              busy={busy}
              stopping={request.kind === "stopping"}
              startedAt={request.kind === "idle" ? null : request.startedAt}
              onStop={onStop}
              notice={notice}
              onNewChat={onNewChat}
              error={error ?? problem}
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
