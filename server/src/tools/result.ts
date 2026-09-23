import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getConfig } from '../config/index.js';
import { truncateUtf8 } from '../util/output.js';

/**
 * Build a Copilot-Studio-safe tool result.
 *
 * We deliberately return a single text block containing JSON rather than using
 * `structuredContent` + `outputSchema`: output schemas can contain `$ref`,
 * which Copilot Studio silently drops, removing the whole tool. The JSON text
 * is truncated to the configured byte budget so we never exceed the ~500 KB cap.
 */
export function jsonResult(data: unknown, isError = false): CallToolResult {
  const cfg = getConfig();
  const raw = JSON.stringify(data, null, 2);
  const { text } = truncateUtf8(raw, cfg.MAX_OUTPUT_BYTES);
  return {
    content: [{ type: 'text', text }],
    isError,
  };
}

export function errorResult(message: string, details?: unknown): CallToolResult {
  return jsonResult({ ok: false, error: message, details }, true);
}
