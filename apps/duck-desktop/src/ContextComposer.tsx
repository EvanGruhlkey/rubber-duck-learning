import { useState, type ReactNode } from "react";
import type { TutorSession } from "./tutor";

interface Props { session: TutorSession; locked: boolean; onAttachFile: () => void; onChange: (update: (session: TutorSession) => TutorSession) => void; children?: ReactNode }
export function ContextComposer({ session, locked, onAttachFile, onChange, children }: Props) {
  const [adding, setAdding] = useState<"menu" | "code" | "error" | null>(null);
  const [text, setText] = useState("");
  return <div className="context-composer">
    {session.attachments.length > 0 && <div className="context-list" aria-label="Attached context">{session.attachments.map((context) => <div className="context-item" key={context.id}>
      <details><summary>{context.label}</summary><pre>{context.text}</pre></details>
      <button type="button" disabled={locked} aria-label={`Remove ${context.label}`} onClick={() => onChange((previous) => ({ ...previous, attachments: previous.attachments.filter((item) => item.id !== context.id) }))}>×</button>
    </div>)}</div>}
    <button type="button" className="context-toggle" aria-label="Add context" title="More" aria-expanded={adding !== null} disabled={locked} onClick={() => setAdding(adding === null ? "menu" : null)}>+</button>
    {adding === "menu" && <div className="compact-actions">
      <button type="button" disabled={locked || session.attachments.length >= 3} onClick={() => { setAdding(null); onAttachFile(); }}>Project file</button>
      <button type="button" disabled={session.attachments.length >= 3} onClick={() => setAdding("code")}>Paste code</button>
      <button type="button" disabled={session.attachments.length >= 3} onClick={() => setAdding("error")}>Paste error</button>
      <div className="workspace-actions" onClick={() => setAdding(null)}>{children}</div>
    </div>}
    {(adding === "code" || adding === "error") && <div className="paste-context">
      <label htmlFor="pasted-context">{adding === "code" ? "Code selection" : "Error output"}</label>
      <textarea id="pasted-context" value={text} maxLength={65_536} disabled={locked} rows={3} onChange={(event) => setText(event.target.value)} />
      <div className="compact-actions">
        <button type="button" disabled={locked || !text.trim() || session.attachments.length >= 3} onClick={() => {
          const context = { id: crypto.randomUUID(), kind: adding, label: adding === "code" ? "Pasted code" : "Pasted error", text };
          onChange((previous) => ({ ...previous, attachments: [...previous.attachments, context].slice(0, 3) }));
          setText(""); setAdding(null);
        }}>Attach</button>
        <button type="button" onClick={() => { setText(""); setAdding(null); }}>Cancel</button>
      </div>
    </div>}
  </div>;
}
