import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { suggestedSteps, type ChatTurn } from "./tutor";
import type { PlanSuggestion } from "./PlanPanel";

export function ChatTranscript({ turns, onReviewPlan, locked, pending }: { turns: ChatTurn[]; onReviewPlan: (suggestion: PlanSuggestion) => void; locked: boolean; pending: { question: string; answer: string } | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = ref.current?.parentElement;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [turns, pending?.answer, pending?.question]);
  return <div className="conversation" role="log" aria-label="Conversation" ref={ref}>
    {!pending && turns.slice(-1).map((turn) => {
      const steps = suggestedSteps(turn.answer);
      return <div className="conversation-turn" key={turn.id}>
        <div className="speech-bubble-reply markdown-reply">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children, ...rest }) => <a {...rest} href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{turn.answer}</ReactMarkdown>
        </div>
        {steps.length > 0 && <button className="review-plan" type="button" aria-label="Review suggested plan" disabled={locked} onClick={() => onReviewPlan({ sourceTurnId: turn.id, items: steps })}>View plan</button>}
      </div>;
    })}
    {pending && <div className="conversation-turn pending-turn">
      <div className="speech-bubble-reply markdown-reply" aria-label="Current reply" aria-busy="true">
        {pending.answer ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children, ...rest }) => <a {...rest} href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{pending.answer}</ReactMarkdown> : <span className="thinking-dots" role="status" aria-label="Thinking">…</span>}
      </div>
    </div>}
  </div>;
}
