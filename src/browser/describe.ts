import type { FrontendErrorPayload } from './listener.js';

export function describeError(p: FrontendErrorPayload): string {
  return [
    `Source: ${p.source}`,
    `Page: ${p.pageUrl}`,
    `Error: ${p.name}: ${p.message}`,
    p.filePath ? `Location: ${p.filePath}:${p.line}:${p.column}` : 'Location: unknown',
    p.stack ? `Stack trace:\n${p.stack}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
