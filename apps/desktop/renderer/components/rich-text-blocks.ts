/**
 * Block structure of an agent reply. Kept free of JSX so it can be tested
 * directly and so the renderer stays a thin mapping over it.
 */
export interface Block {
  kind: 'paragraph' | 'code' | 'bullets' | 'numbers' | 'heading';
  lines: string[];
  level?: number;
}
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim().startsWith('```')) {
      const body: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith('```'))
        body.push(lines[index++]);
      index++;
      blocks.push({ kind: 'code', lines: body });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', lines: [heading[2]], level: heading[1].length });
      index++;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index]))
        items.push(lines[index++].replace(/^\s*[-*+]\s+/, ''));
      blocks.push({ kind: 'bullets', lines: items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index]))
        items.push(lines[index++].replace(/^\s*\d+[.)]\s+/, ''));
      blocks.push({ kind: 'numbers', lines: items });
      continue;
    }
    if (!line.trim()) {
      index++;
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*([-*+]|\d+[.)])\s+/.test(lines[index]) &&
      !lines[index].trim().startsWith('```') &&
      !/^#{1,4}\s+/.test(lines[index])
    )
      paragraph.push(lines[index++]);
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }
  return blocks;
}
