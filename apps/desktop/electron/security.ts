import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export function trustedURL(value: string, developmentOrigin?: string): boolean {
  try {
    const url = new URL(value);
    return developmentOrigin
      ? url.origin === developmentOrigin
      : url.protocol === 'orchestra:' &&
          url.hostname === 'app' &&
          !url.port &&
          !url.username &&
          !url.password;
  } catch {
    return false;
  }
}
export function trustedSender(
  sender: unknown,
  expectedSender: unknown,
  frame: unknown,
  mainFrame: unknown,
  url: string,
  developmentOrigin?: string,
): boolean {
  return (
    !!sender &&
    !!frame &&
    sender === expectedSender &&
    frame === mainFrame &&
    trustedURL(url, developmentOrigin)
  );
}
export function resolveAsset(root: string, input: string): string {
  if (!trustedURL(input)) throw new Error('Untrusted application URL.');
  // Inspect the raw path before URL parsing normalizes dot segments.
  const raw = input.replace(/^orchestra:\/\/app/i, '').split(/[?#]/)[0];
  const decoded = decodeURIComponent(raw);
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..'))
    throw new Error('Invalid asset path.');
  const url = new URL(input);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const result = path.resolve(root, '.' + pathname);
  if (!result.startsWith(path.resolve(root) + path.sep))
    throw new Error('Asset escapes the application directory.');
  return result;
}
export function contentPolicy(html: string): string {
  const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/\bsrc\s*=/i.test(match[1]))
    .map((match) => `'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
  return `default-src 'self'; script-src 'self' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'`;
}
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
export async function assetResponse(root: string, url: string): Promise<Response> {
  try {
    const candidate = resolveAsset(root, url);
    const [resolvedRoot, file] = await Promise.all([realpath(root), realpath(candidate)]);
    if (!file.startsWith(resolvedRoot + path.sep))
      return new Response('Forbidden', { status: 403 });
    const data = await readFile(file);
    const headers: Record<string, string> = {
      'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    };
    if (file.endsWith('.html')) headers['Content-Security-Policy'] = contentPolicy(data.toString());
    return new Response(new Uint8Array(data), { headers });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
