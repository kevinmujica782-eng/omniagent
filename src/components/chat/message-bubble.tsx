import { Fragment } from "react";
import { AgentCardView } from "@/components/chat/cards";
import { ReportMessage } from "@/components/chat/report-message";
import type { ChatMessageView } from "@/types/cards";

/** Negritas simples (**texto**) sin HTML arbitrario. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.length > 4 && part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function MessageBubble({
  message,
  timeZone,
  demo,
  reportable = false,
}: {
  message: ChatMessageView;
  timeZone?: string;
  demo?: boolean;
  /** Muestra "Reportar" bajo las respuestas de Omni (en el chat; no en la portada). */
  reportable?: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-on-primary">
          {message.text}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2.5">
      {message.text ? (
        <p className="max-w-[92%] whitespace-pre-wrap rounded-3xl rounded-bl-lg border border-line bg-surface px-4 py-2.5 text-[15px] leading-relaxed text-ink">
          <RichText text={message.text} />
        </p>
      ) : null}
      {message.cards.map((card, index) => (
        <AgentCardView key={`${card.kind}-${index}`} card={card} timeZone={timeZone} demo={demo} />
      ))}
      {reportable && !message.id.startsWith("local-") ? <ReportMessage messageId={message.id} demo={demo} /> : null}
    </div>
  );
}
