import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getConfig } from '../config/index.js';
import { truncateUtf8 } from '../util/output.js';

/**
 * Build a tool result that every MCP client can read.
 *
 * We deliberately return a single text block containing JSON rather than using
 * `structuredContent` + `outputSchema`: output schemas can contain `$ref`,
 * which some MCP clients silently drop, removing the whole tool. The JSON text
 * is truncated to the configured byte budget so responses stay small.
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
