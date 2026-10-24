import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useRef } from "react";

export interface ChatTurn {
  question: string;
  answer: string;
}

interface SpeechBubbleProps {
  message: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  inputPlaceholder?: string;
  onAsk: () => void;
  busy: boolean;
  turns: ChatTurn[];
  onNewChat: () => void;
  error: string | null;
}

/** Soft card + tail; hint, input, Ask, and reply area. */
export function SpeechBubble({
  message,
  inputValue,
  onInputChange,
  inputPlaceholder = "Describe the bug, your theory, or paste an error…",
  onAsk,
  busy,
  turns,
  onNewChat,
  error,
}: SpeechBubbleProps) {
  const conversationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [turns]);

  return (
    <div className="speech-bubble no-drag" role="region" aria-label="Rubber duck chat">
      <div className="speech-bubble-inner">
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
            disabled={busy || !inputValue.trim()}
            onClick={onAsk}
          >
            {busy ? "Thinking…" : "Ask the duck"}
          </button>
          <button type="button" className="speech-bubble-secondary" disabled={busy || (!turns.length && !inputValue && !error)} onClick={onNewChat}>
            New chat
          </button>
        </div>
        {error && (
          <pre className="speech-bubble-error" role="alert">
            {error}
          </pre>
        )}
      </div>
    </div>
  );
}
