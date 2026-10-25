import { useState } from "react";
import type { TutorSession } from "./tutor";

interface Props { session: TutorSession; locked: boolean; onAttachFile: () => void; onChange: (update: (session: TutorSession) => TutorSession) => void }
export function ContextComposer({ session, locked, onAttachFile, onChange }: Props) {
  const [adding, setAdding] = useState<"menu" | "code" | "error" | null>(null);
  const [text, setText] = useState("");
  return <div className="context-composer">
    {session.attachments.length > 0 && <div className="context-list" aria-label="Attached context">{session.attachments.map((context) => <div className="context-item" key={context.id}>
      <details><summary>{context.label}</summary><pre>{context.text}</pre></details>
      <button type="button" disabled={locked} aria-label={`Remove ${context.label}`} onClick={() => onChange((previous) => ({ ...previous, attachments: previous.attachments.filter((item) => item.id !== context.id) }))}>Remove</button>
    </div>)}</div>}
    <button type="button" className="context-toggle" disabled={locked || session.attachments.length >= 3} onClick={() => setAdding(adding === null ? "menu" : null)}>Add context{session.attachments.length > 0 ? ` (${session.attachments.length}/3)` : ""}</button>
    {adding === "menu" && <div className="compact-actions">
      <button type="button" disabled={locked} onClick={() => { setAdding(null); onAttachFile(); }}>Project file</button>
      <button type="button" onClick={() => setAdding("code")}>Paste code</button>
      <button type="button" onClick={() => setAdding("error")}>Paste error</button>
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
