import { AGENT_MODE_TOOLS, AGENT_MODE_TOOL_LABELS } from '@orchestrai/shared-types';
import type { Snapshot } from '@orchestrai/shared-types';

/**
 * A turn's partial text belongs to the conversation that asked for it. The
 * snapshot carries one live stream for the session, so the view has to decide
 * whether it is looking at its own.
 */
export function visibleStream(
  streaming: Snapshot['streaming'],
  conversationId: string,
): Snapshot['streaming'] {
  return streaming && streaming.conversationId === conversationId ? streaming : null;
}

/**
 * What Agent mode may do unattended, as a producer reads it. Derived from the
 * permission list itself so the disclosure cannot drift from what runs.
 */
export function standingList(tools: readonly string[] = AGENT_MODE_TOOLS): string {
  const labels = [
    ...new Set(
      tools.map(
        (tool) => AGENT_MODE_TOOL_LABELS[tool as (typeof AGENT_MODE_TOOLS)[number]] ?? tool,
      ),
    ),
  ];
  return labels
    .map((label, index) =>
      index === labels.length - 1 && labels.length > 1 ? `and ${label}` : label,
    )
    .join(', ');
}
