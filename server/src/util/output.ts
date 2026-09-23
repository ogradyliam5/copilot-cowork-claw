/**
 * Output-limiting helpers. Copilot Studio rejects connector responses over
 * ~500 KB, so every tool truncates its output to a configured byte budget.
 */

export interface TruncateResult {
  text: string;
  truncated: boolean;
  bytesReturned: number;
  totalBytes: number;
}

/**
 * Truncate a UTF-8 string to at most `maxBytes`, keeping the tail-friendly
 * head of the content and appending a marker when truncated.
 */
export function truncateUtf8(input: string, maxBytes: number): TruncateResult {
  const buf = Buffer.from(input, 'utf8');
  const totalBytes = buf.length;
  if (totalBytes <= maxBytes) {
    return { text: input, truncated: false, bytesReturned: totalBytes, totalBytes };
  }
  const marker = `\n…[truncated ${totalBytes - maxBytes} of ${totalBytes} bytes]`;
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  const keep = Math.max(0, maxBytes - markerBytes);
  // Avoid slicing through a multi-byte character.
  let sliced = buf.subarray(0, keep).toString('utf8');
  sliced = sliced.replace(/�+$/u, '');
  const text = sliced + marker;
  return {
    text,
    truncated: true,
    bytesReturned: Buffer.byteLength(text, 'utf8'),
    totalBytes,
  };
}

/** Read a byte-range window from a string for offset/limit pagination. */
export function windowUtf8(
  input: string,
  offset: number,
  maxBytes: number,
): { chunk: string; nextOffset: number; eof: boolean; truncated: boolean } {
  const buf = Buffer.from(input, 'utf8');
  const start = Math.min(Math.max(0, offset), buf.length);
  const end = Math.min(start + maxBytes, buf.length);
  let chunk = buf.subarray(start, end).toString('utf8').replace(/�+$/u, '');
  const eof = end >= buf.length;
  return { chunk, nextOffset: end, eof, truncated: !eof };
}
