import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MachineAdapter, FsEncoding, FsOp } from '../core/adapter.js';
import { jsonResult, errorResult } from './result.js';
import { getConfig } from '../config/index.js';

const VALID_ENCODINGS: FsEncoding[] = ['utf8', 'base64'];
const VALID_WRITE_MODES = ['overwrite', 'append', 'create'] as const;
const VALID_OPS: FsOp[] = ['copy', 'move', 'delete', 'mkdir'];

function toEncoding(value: string | undefined): FsEncoding {
  return value === 'base64' ? 'base64' : 'utf8';
}

/**
 * Filesystem tools — read, write, list, search, mutate (copy/move/delete/mkdir),
 * and stat files/directories on the machine. All work is delegated to the
 * MachineAdapter so the tool layer stays platform-agnostic.
 */
export function registerFilesystem(server: McpServer, adapter: MachineAdapter): void {
  server.registerTool(
    'fs_read',
    {
      title: 'Read a file',
      annotations: { title: 'Read a file', readOnlyHint: true, openWorldHint: false },
      description:
        'Read a file from the machine, optionally starting at a byte offset. Use this to inspect file contents, logs, or config. For large files, page through with offset/maxBytes until eof is true.',
      inputSchema: {
        path: z.string().describe('Absolute (or working-directory-relative) path to the file.'),
        encoding: z.string().optional().describe('"utf8" (default) or "base64" for binary-safe reads.'),
        offset: z.number().optional().describe('Byte offset to start reading from. Defaults to 0.'),
        maxBytes: z.number().optional().describe('Maximum bytes to return. Defaults to the server output cap.'),
      },
    },
    async (input) => {
      try {
        const cfg = getConfig();
        const encoding = toEncoding(input.encoding);
        const offset = input.offset ?? 0;
        const maxBytes = input.maxBytes ?? cfg.MAX_OUTPUT_BYTES;
        const res = await adapter.fsRead(input.path, encoding, offset, maxBytes);
        return jsonResult({
          ok: true,
          path: input.path,
          content: res.content,
          encoding: res.encoding,
          bytesReturned: res.bytesReturned,
          truncated: res.truncated,
          eof: res.eof,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'fs_write',
    {
      title: 'Write a file',
      annotations: { title: 'Write a file', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      description:
        'Write, append to, or create a file on the machine. Creates parent directories automatically. Use mode "create" to fail if the file already exists, "append" to add to it, or "overwrite" (default) to replace it.',
      inputSchema: {
        path: z.string().describe('Absolute (or working-directory-relative) path to the file.'),
        content: z.string().describe('Content to write, encoded per the `encoding` parameter.'),
        encoding: z.string().optional().describe('"utf8" (default) or "base64" for binary-safe writes.'),
        mode: z.string().optional().describe('"overwrite" (default), "append", or "create".'),
      },
    },
    async (input) => {
      try {
        const encoding = toEncoding(input.encoding);
        const mode = VALID_WRITE_MODES.includes(input.mode as (typeof VALID_WRITE_MODES)[number])
          ? (input.mode as (typeof VALID_WRITE_MODES)[number])
          : 'overwrite';
        const res = await adapter.fsWrite(input.path, input.content, encoding, mode);
        return jsonResult({ ok: true, path: res.path, bytesWritten: res.bytesWritten });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'fs_list',
    {
      title: 'List a directory',
      annotations: { title: 'List a directory', readOnlyHint: true, openWorldHint: false },
      description:
        'List files and directories under a path, optionally recursively and filtered by a glob pattern (e.g. "*.ts"). Use this to explore the filesystem before reading or searching.',
      inputSchema: {
        path: z.string().describe('Directory to list.'),
        recursive: z.boolean().optional().describe('Recurse into subdirectories. Defaults to false.'),
        glob: z.string().optional().describe('Glob pattern (e.g. "*.log") to filter entry names.'),
        maxEntries: z.number().optional().describe('Maximum entries to return. Defaults to 1000.'),
      },
    },
    async (input) => {
      try {
        const maxEntries = input.maxEntries ?? 1000;
        const res = await adapter.fsList(input.path, input.recursive ?? false, input.glob, maxEntries);
        return jsonResult({ ok: true, entries: res.entries, truncated: res.truncated, count: res.entries.length });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'fs_search',
    {
      title: 'Search file contents',
      annotations: { title: 'Search file contents', readOnlyHint: true, openWorldHint: false },
      description:
        'Search for a literal string or regex pattern across files under a root directory, returning matching path/line/text triples. Use this to find where something is defined or referenced instead of reading many files individually.',
      inputSchema: {
        root: z.string().describe('Directory to search under (recursive).'),
        query: z.string().describe('Literal string or regex pattern to search for.'),
        isRegex: z.boolean().optional().describe('Treat `query` as a regular expression. Defaults to false (literal match).'),
        glob: z.string().optional().describe('Glob pattern (e.g. "*.ts") to restrict which files are searched.'),
        maxMatches: z.number().optional().describe('Maximum matches to return. Defaults to 500.'),
      },
    },
    async (input) => {
      try {
        const maxMatches = input.maxMatches ?? 500;
        const res = await adapter.fsSearch(input.root, input.query, input.isRegex ?? false, input.glob, maxMatches);
        return jsonResult({ ok: true, matches: res.matches, truncated: res.truncated, count: res.matches.length });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'fs_op',
    {
      title: 'Copy, move, delete, or mkdir',
      annotations: { title: 'Copy, move, delete, or mkdir', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      description:
        'Perform a filesystem mutation: "copy" or "move" (requires `dest`), "delete", or "mkdir". Use `recursive` for directories. Use this instead of shelling out to copy/del/mkdir commands.',
      inputSchema: {
        op: z.string().describe('One of: copy, move, delete, mkdir.'),
        path: z.string().describe('Source path (or the directory to create/delete).'),
        dest: z.string().optional().describe('Destination path. Required for copy and move.'),
        recursive: z.boolean().optional().describe('Apply recursively (directory copy/delete). Defaults to false.'),
      },
    },
    async (input) => {
      try {
        const op = input.op as FsOp;
        if (!VALID_OPS.includes(op)) {
          return errorResult(`Invalid op "${input.op}". Must be one of: ${VALID_OPS.join(', ')}.`);
        }
        if ((op === 'copy' || op === 'move') && !input.dest) {
          return errorResult(`op "${op}" requires a "dest" parameter.`);
        }
        const res = await adapter.fsOp(op, input.path, input.dest, input.recursive ?? false);
        return jsonResult({ ok: res.ok, op, path: res.path });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'fs_stat',
    {
      title: 'Stat a file or directory',
      annotations: { title: 'Stat a file or directory', readOnlyHint: true, openWorldHint: false },
      description:
        'Get metadata (existence, type, size, modified time, attributes) for a path without reading its contents. Use this to check whether a file exists before reading/writing it.',
      inputSchema: {
        path: z.string().describe('Path to stat.'),
      },
    },
    async (input) => {
      try {
        const stat = await adapter.fsStat(input.path);
        return jsonResult({ ok: true, path: input.path, ...stat });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
