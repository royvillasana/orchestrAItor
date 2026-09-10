import { describe, expect, it } from 'vitest';
import { parseBlocks, type Block } from '../apps/desktop/renderer/components/rich-text-blocks';

describe('agent output blocks', () => {
  it('separates paragraphs, headings, lists, and fenced code', () => {
    const blocks = parseBlocks(
      [
        '## Kicks I found',
        '',
        'Two matches, both in **808 Kicks**:',
        '',
        '- Deep_Kick_01.wav — 0.80s',
        '- Punchy_Kick_02.wav — 0.50s',
        '',
        '1. Load the deep one',
        '2. Layer the punchy one',
        '',
        '```',
        '/library/Drums/808 Kicks/Deep_Kick_01.wav',
        '```',
      ].join('\n'),
    );
    expect(blocks.map((block: Block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'bullets',
      'numbers',
      'code',
    ]);
    expect(blocks[0]).toMatchObject({ level: 2, lines: ['Kicks I found'] });
    expect(blocks[2].lines).toEqual(['Deep_Kick_01.wav — 0.80s', 'Punchy_Kick_02.wav — 0.50s']);
    expect(blocks[4].lines).toEqual(['/library/Drums/808 Kicks/Deep_Kick_01.wav']);
  });
  it('joins wrapped lines into one paragraph and drops blank runs', () => {
    const blocks = parseBlocks('The project is at 126 BPM,\nin 4/4.\n\n\nTransport is stopped.');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].lines.join(' ')).toBe('The project is at 126 BPM, in 4/4.');
  });
  it('keeps code fences literal rather than parsing markup inside them', () => {
    const blocks = parseBlocks('```\n**not bold** and - not a bullet\n```');
    expect(blocks).toEqual([{ kind: 'code', lines: ['**not bold** and - not a bullet'] }]);
  });
  it('treats plain text as a single paragraph', () => {
    expect(parseBlocks('Nothing has changed yet.')).toEqual([
      { kind: 'paragraph', lines: ['Nothing has changed yet.'] },
    ]);
  });
  it('handles an unterminated fence without losing the rest', () => {
    const blocks = parseBlocks('before\n```\nstill code');
    expect(blocks.map((block: Block) => block.kind)).toEqual(['paragraph', 'code']);
    expect(blocks[1].lines).toEqual(['still code']);
  });
});
