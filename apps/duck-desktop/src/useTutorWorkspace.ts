import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createSession, parseSession, type Project, type TutorSession } from "./tutor";

const ACTIVE_PROJECT_KEY = "rubber-duck.active-project.v1";
const sessionKey = (root: string) => `rubber-duck.session.v1:${root}`;
export type Workspace = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; project: Project; session: TutorSession };

export function useTutorWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace>({ kind: "loading" });
  const current = useRef<Workspace>(workspace);
  const generation = useRef(0);
  const writable = useRef(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  const activate = useCallback((project: Project) => {
    let session = createSession();
    writable.current = true;
    setStorageError(null);
    try {
      const raw = localStorage.getItem(sessionKey(project.root));
      if (raw !== null) session = parseSession(raw);
      localStorage.setItem(ACTIVE_PROJECT_KEY, project.root);
    } catch {
      writable.current = false;
      setStorageError("Saved progress could not be restored. It has not been overwritten. Start fresh to save a new session.");
    }
    const next: Workspace = { kind: "ready", project, session };
    current.current = next;
    setWorkspace(next);
    setProblem(null);
  }, []);

  useEffect(() => {
    const version = ++generation.current;
    let path: string | null = null;
    try { path = localStorage.getItem(ACTIVE_PROJECT_KEY); } catch { /* storage errors are surfaced by activate */ }
    void invoke<Project>("duck_project", { path }).then((project) => {
      if (version === generation.current) activate(project);
    }).catch((error: unknown) => {
      if (version !== generation.current) return;
      const next: Workspace = { kind: "error", message: String(error) };
      current.current = next;
      setWorkspace(next);
    });
    return () => { generation.current += 1; };
  }, [activate]);

  const updateSession = useCallback((update: (session: TutorSession) => TutorSession, expectedRoot?: string) => {
    const previous = current.current;
    if (previous.kind !== "ready" || (expectedRoot !== undefined && previous.project.root !== expectedRoot)) return;
    const session = update(previous.session);
    const next: Workspace = { ...previous, session };
    current.current = next;
    setWorkspace(next);
    if (!writable.current) return;
    try {
      localStorage.setItem(sessionKey(previous.project.root), JSON.stringify(session));
      setStorageError(null);
    } catch {
      setStorageError("Progress could not be saved on this device. Keep this window open to avoid losing changes.");
    }
  }, []);

  const chooseProject = useCallback(async () => {
    const version = ++generation.current;
    try {
      const project = await invoke<Project | null>("duck_choose_project");
      if (project && version === generation.current) activate(project);
    } catch (error) { setProblem(String(error)); }
  }, [activate]);

  const startFresh = useCallback(() => {
    writable.current = true;
    updateSession(() => createSession());
  }, [updateSession]);

  return { workspace, updateSession, chooseProject, startFresh, problem, storageError };
}
