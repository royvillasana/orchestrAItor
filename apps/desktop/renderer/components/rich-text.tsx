import type { ReactNode } from 'react';
import { parseBlocks, type Block } from './rich-text-blocks';

/**
 * Agent replies arrive as Markdown-ish text. This renders the small subset that
 * actually shows up — emphasis, inline code, fenced code, headings, and lists —
 * as React nodes. Nothing is ever injected as HTML: a model's output is
 * untrusted text, and the renderer has no business parsing markup from it.
 */
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(INLINE)
    .filter(Boolean)
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`;
      if (part.startsWith('**') && part.endsWith('**'))
        return (
          <strong key={key} className="font-semibold text-paper">
            {part.slice(2, -2)}
          </strong>
        );
      if (part.startsWith('`') && part.endsWith('`'))
        return (
          <code
            key={key}
            // Sample paths are long; they wrap inside the chip rather than
            // stretching the column.
            className="break-all rounded bg-raised px-1 py-0.5 font-mono text-[0.9em] text-accent"
          >
            {part.slice(1, -1)}
          </code>
        );
      if (
        (part.startsWith('*') && part.endsWith('*')) ||
        (part.startsWith('_') && part.endsWith('_'))
      )
        return (
          <em key={key} className="italic">
            {part.slice(1, -1)}
          </em>
        );
      return <span key={key}>{part}</span>;
    });
}

export function RichText({ text }: { text: string }) {
  const blocks: Block[] = parseBlocks(text);
  return (
    <div className="space-y-3 text-sm leading-7">
      {blocks.map((block, index) => {
        const key = `block-${index}`;
        if (block.kind === 'code')
          return (
            <pre
              key={key}
              className="overflow-x-auto rounded-lg border border-line bg-ink/60 p-3 font-mono text-xs leading-6 text-muted"
            >
              <code>{block.lines.join('\n')}</code>
            </pre>
          );
        if (block.kind === 'heading') {
          const size = block.level === 1 ? 'text-base' : 'text-sm';
          return (
            <h3 key={key} className={`${size} font-semibold text-paper`}>
              {inline(block.lines[0], key)}
            </h3>
          );
        }
        if (block.kind === 'bullets' || block.kind === 'numbers') {
          const List = block.kind === 'bullets' ? 'ul' : 'ol';
          return (
            <List
              key={key}
              className={`space-y-1 pl-5 ${block.kind === 'bullets' ? 'list-disc' : 'list-decimal'} marker:text-muted`}
            >
              {block.lines.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{inline(item, `${key}-${itemIndex}`)}</li>
              ))}
            </List>
          );
        }
        return <p key={key}>{inline(block.lines.join(' '), key)}</p>;
      })}
    </div>
  );
}
