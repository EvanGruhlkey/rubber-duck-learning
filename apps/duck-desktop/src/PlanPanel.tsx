import { useState } from "react";
import type { TutorSession } from "./tutor";

export interface PlanSuggestion { sourceTurnId: string; items: string[] }
interface Props {
  session: TutorSession;
  locked: boolean;
  suggestion: PlanSuggestion | null;
  onChange: (update: (session: TutorSession) => TutorSession) => void;
  onDismissSuggestion: () => void;
  onDiscuss: (step: string) => void;
}

export function PlanPanel({ session, locked, suggestion, onChange, onDismissSuggestion, onDiscuss }: Props) {
  const [newStep, setNewStep] = useState("");
  const completed = session.steps.filter((step) => step.done).length;
  function adopt(append: boolean) {
    if (!suggestion || locked) return;
    const steps = suggestion.items.map((text) => ({ id: crypto.randomUUID(), text, done: false, sourceTurnId: suggestion.sourceTurnId }));
    onChange((previous) => ({ ...previous, mode: "build", steps: [...(append ? previous.steps : []), ...steps].slice(0, 30) }));
    onDismissSuggestion();
  }
  return (
    <div className="plan-panel">
      {suggestion && <section className="plan-preview" aria-label="Suggested plan preview">
        <h3>Review the suggested steps</h3>
        <ol>{suggestion.items.map((item, index) => <li key={index}>{item}</li>)}</ol>
        <p>These start unchecked. Only you mark your progress.</p>
        <div className="compact-actions">
          {session.steps.length > 0 && <button type="button" disabled={locked} onClick={() => adopt(true)}>Append steps</button>}
          <button type="button" disabled={locked} onClick={() => adopt(false)}>{session.steps.length ? "Replace plan" : "Use plan"}</button>
          <button type="button" onClick={onDismissSuggestion}>Cancel</button>
        </div>
      </section>}
      <p className="progress-count">{completed} of {session.steps.length} steps checked by you</p>
      {session.steps.length === 0 && !suggestion && <p className="empty-state">Ask the duck for a small plan, or add your first step below.</p>}
      <ol className="plan-steps">{session.steps.map((step, index) => <li key={step.id} className={step.done ? "step-complete" : undefined}>
        <div className="plan-step-main">
          <input type="checkbox" checked={step.done} disabled={locked} aria-label={`Mark step ${index + 1} complete`} onChange={(event) => onChange((previous) => ({ ...previous, steps: previous.steps.map((item) => item.id === step.id ? { ...item, done: event.target.checked } : item) }))} />
          <input type="text" value={step.text} maxLength={500} disabled={locked} aria-label={`Step ${index + 1}`} onChange={(event) => onChange((previous) => ({ ...previous, steps: previous.steps.map((item) => item.id === step.id ? { ...item, text: event.target.value } : item) }))} />
        </div>
        <div className="step-actions">
          <button type="button" disabled={locked} aria-label={`Discuss step ${index + 1}`} onClick={() => onDiscuss(step.text)}>Discuss</button>
          <button type="button" disabled={locked} aria-label={`Remove step ${index + 1}`} onClick={() => onChange((previous) => ({ ...previous, steps: previous.steps.filter((item) => item.id !== step.id) }))}>Remove</button>
        </div>
      </li>)}</ol>
      <form className="add-step" onSubmit={(event) => {
        event.preventDefault();
        if (!newStep.trim() || locked || session.steps.length >= 30) return;
        onChange((previous) => ({ ...previous, steps: [...previous.steps, { id: crypto.randomUUID(), text: newStep.trim(), done: false }] }));
        setNewStep("");
      }}>
        <input aria-label="New step" placeholder="Add a small step..." value={newStep} maxLength={500} disabled={locked} onChange={(event) => setNewStep(event.target.value)} />
        <button type="submit" disabled={locked || !newStep.trim() || session.steps.length >= 30}>Add step</button>
      </form>
    </div>
  );
}
