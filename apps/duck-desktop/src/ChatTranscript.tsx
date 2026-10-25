import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { suggestedSteps, type ChatTurn } from "./tutor";
import type { PlanSuggestion } from "./PlanPanel";

export function ChatTranscript({ turns, onReviewPlan, locked }: { turns: ChatTurn[]; onReviewPlan: (suggestion: PlanSuggestion) => void; locked: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [turns]);
  return <div className="conversation" role="log" aria-label="Conversation" ref={ref}>
    {turns.map((turn, index) => {
      const steps = suggestedSteps(turn.answer);
      return <div className="conversation-turn" key={turn.id}>
        <p className="speech-bubble-reply-label">You <span className="turn-mode">{turn.mode}</span></p>
        <p className="conversation-question">{turn.question}</p>
        {turn.attachments.map((context) => <details className="submitted-context" key={context.id}><summary>{context.label}</summary><pre>{context.text}</pre></details>)}
        <p className="speech-bubble-reply-label">Duck</p>
        <div className="speech-bubble-reply markdown-reply">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children, ...rest }) => <a {...rest} href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{turn.answer}</ReactMarkdown>
        </div>
        {index === turns.length - 1 && steps.length > 0 && <button className="review-plan" type="button" disabled={locked} onClick={() => onReviewPlan({ sourceTurnId: turn.id, items: steps })}>Review suggested plan</button>}
      </div>;
    })}
  </div>;
}
