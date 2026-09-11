import { describe, expect, it } from 'vitest';
import { standingList, visibleStream } from '../apps/desktop/renderer/components/session-view';
import { AGENT_MODE_TOOLS } from '../packages/shared-types/src';

describe('what the session view shows', () => {
  it('shows streamed text only in the conversation that asked for it', () => {
    const stream = { conversationId: 'a', text: 'raising the pad…', done: false };
    expect(visibleStream(stream, 'a')).toBe(stream);
    // Opening another conversation mid-turn must not show it that turn's text.
    expect(visibleStream(stream, 'b')).toBeNull();
    expect(visibleStream(null, 'a')).toBeNull();
  });

  it('names exactly the tools that run without approval', () => {
    const named = standingList();
    expect(named).toBe('tempo, transport, track levels, track mute, and track solo');
    // The disclosure is the list: a plugin write is not on it.
    expect(AGENT_MODE_TOOLS).not.toContain('plugin.set_quick_control');
    expect(named).not.toMatch(/plugin|quick/i);
    // And it cannot silently omit a tool that is added later.
    expect(standingList([...AGENT_MODE_TOOLS, 'plugin.set_quick_control'])).toContain(
      'plugin.set_quick_control',
    );
  });
});
