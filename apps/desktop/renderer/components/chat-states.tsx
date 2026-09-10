import { RichText } from './rich-text';

/**
 * The states a turn actually passes through, drawn from what the runtime
 * reports rather than from a timer: waiting for the agent to start, text
 * arriving, tools running, and how it ended.
 */
export function Shimmer({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-shimmer rounded bg-[linear-gradient(90deg,var(--color-raised)_0%,var(--color-line)_40%,var(--color-raised)_80%)] bg-[length:200%_100%] ${className}`}
    />
  );
}
/** Shown between sending and the first token, where a spinner says nothing. */
export function ThinkingBubble({ label }: { label: string }) {
  return (
    <div className="space-y-3" aria-live="polite" aria-label={`${label} is working`}>
      <div className="flex items-center gap-2 text-[11px] text-muted">
        <span className="flex gap-1">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
              style={{ animationDelay: `${dot * 160}ms` }}
            />
          ))}
        </span>
        {label} is thinking
      </div>
      <Shimmer className="h-3 w-[85%]" />
      <Shimmer className="h-3 w-[70%]" />
      <Shimmer className="h-3 w-[45%]" />
    </div>
  );
}
/** Text as it arrives, with a caret so a paused stream still reads as live. */
export function StreamingMessage({ provider, text }: { provider: string; text: string }) {
  return (
    <div aria-live="polite">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        {provider}
      </div>
      <div className="text-paper/85">
        <RichText text={text} />
      </div>
      <span className="mt-1 inline-block h-4 w-[2px] animate-pulse bg-accent align-text-bottom" />
    </div>
  );
}
const toolTone: Record<string, string> = {
  'awaiting-approval': 'border-warm/40 text-warm',
  running: 'border-accent/40 text-accent',
  succeeded: 'border-line text-muted',
  failed: 'border-warm/50 text-warm',
  denied: 'border-warm/50 text-warm',
  cancelled: 'border-line text-muted',
};
/** A tool call as a chip in the transcript, where the agent's reasoning is. */
export function ToolChip({ tool, status, args }: { tool: string; status: string; args?: string }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[10px] ${
        toolTone[status] ?? 'border-line text-muted'
      }`}
      title={args}
    >
      {status === 'running' && <span className="h-1 w-1 animate-ping rounded-full bg-accent" />}
      <span className="truncate">{tool}</span>
      <span className="opacity-60">{status}</span>
    </span>
  );
}
export function TurnError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-warm/40 bg-warm/5 p-4" role="alert">
      <p className="text-xs font-medium text-warm">The turn did not finish</p>
      <p className="mt-1 break-words text-[11px] leading-5 text-muted">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-muted transition hover:border-muted hover:text-paper"
        >
          Try again
        </button>
      )}
    </div>
  );
}
