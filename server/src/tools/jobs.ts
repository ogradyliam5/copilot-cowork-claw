import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JobManager } from '../jobs/manager.js';
import { jsonResult, errorResult } from './result.js';
import { getConfig } from '../config/index.js';

const VALID_SHELLS = ['exec', 'powershell'] as const;
const VALID_STREAMS = ['stdout', 'stderr', 'both'] as const;

/**
 * Job tools — start, poll, and manage long-running detached processes.
 *
 * Claw PC stops `exec`/`powershell` calls after 25 seconds (Cowork expects every
 * call to finish within 30), so anything that might run longer (builds, installs,
 * test suites, long scripts) must be started with `job_start` and then polled with
 * `job_status`/`job_output` rather than run synchronously.
 */
export function registerJobs(server: McpServer, jobs: JobManager): void {
  server.registerTool(
    'job_start',
    {
      title: 'Start a background job',
      annotations: { title: 'Start a background job', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      description:
        'Start a long-running command as a detached background job and return immediately with a jobId. Use this for builds, tests, installs, or anything that might take longer than ~20 seconds. Poll progress with job_status and job_output (using the returned offset) rather than waiting synchronously.',
      inputSchema: {
        command: z.string().describe('For shell "exec", the executable name/path. For shell "powershell", the full script text.'),
        args: z.array(z.string()).optional().describe('Argument list, used only when shell is "exec".'),
        cwd: z.string().optional().describe('Working directory. Defaults to the claw workspace folder.'),
        env: z.record(z.string(), z.string()).optional().describe('Extra environment variables merged over the process environment.'),
        shell: z.string().optional().describe('"exec" (default) to spawn command+args directly, or "powershell" to run `command` as a PowerShell script.'),
      },
    },
    async (input) => {
      try {
        const shell = VALID_SHELLS.includes(input.shell as (typeof VALID_SHELLS)[number])
          ? (input.shell as (typeof VALID_SHELLS)[number])
          : 'exec';
        const record = await jobs.start({
          command: input.command,
          args: input.args,
          cwd: input.cwd,
          env: input.env,
          shell,
        });
        return jsonResult({ ok: true, jobId: record.jobId, pid: record.pid, status: record.status });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'job_status',
    {
      title: 'Get background job status',
      annotations: { title: 'Get background job status', readOnlyHint: true, openWorldHint: false },
      description:
        'Get the current status (running, exited, failed, cancelled), exit code, and timing for a background job started with job_start.',
      inputSchema: {
        jobId: z.string().describe('Job ID returned by job_start.'),
      },
    },
    async (input) => {
      try {
        const record = await jobs.status(input.jobId);
        if (!record) return errorResult(`Unknown jobId: ${input.jobId}`);
        return jsonResult({ ok: true, ...record });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'job_output',
    {
      title: 'Read background job output',
      annotations: { title: 'Read background job output', readOnlyHint: true, openWorldHint: false },
      description:
        'Read a byte-range window of a background job\'s stdout/stderr log, starting at `offset` (default 0). Use the returned `nextOffset` on the next call to page through output incrementally; `eof` is true once you have caught up to the job\'s current output.',
      inputSchema: {
        jobId: z.string().describe('Job ID returned by job_start.'),
        stream: z.string().optional().describe('"stdout", "stderr", or "both" (default).'),
        offset: z.number().optional().describe('Byte offset to start reading from. Defaults to 0.'),
        maxBytes: z.number().optional().describe('Maximum bytes to return. Defaults to the server output cap.'),
      },
    },
    async (input) => {
      try {
        const cfg = getConfig();
        const stream = VALID_STREAMS.includes(input.stream as (typeof VALID_STREAMS)[number])
          ? (input.stream as (typeof VALID_STREAMS)[number])
          : 'both';
        const offset = input.offset ?? 0;
        const maxBytes = input.maxBytes ?? cfg.MAX_OUTPUT_BYTES;
        const res = await jobs.output(input.jobId, stream, offset, maxBytes);
        return jsonResult({
          ok: true,
          jobId: input.jobId,
          chunk: res.chunk,
          nextOffset: res.nextOffset,
          eof: res.eof,
          truncated: res.truncated,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'job_cancel',
    {
      title: 'Cancel a background job',
      annotations: { title: 'Cancel a background job', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      description: 'Forcibly kill a running background job started with job_start.',
      inputSchema: {
        jobId: z.string().describe('Job ID returned by job_start.'),
      },
    },
    async (input) => {
      try {
        const record = await jobs.cancel(input.jobId);
        return jsonResult({ ok: true, jobId: record.jobId, status: record.status });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    'job_list',
    {
      title: 'List background jobs',
      annotations: { title: 'List background jobs', readOnlyHint: true, openWorldHint: false },
      description: 'List background jobs, optionally filtered by status (running, exited, failed, cancelled), newest first.',
      inputSchema: {
        status: z.string().optional().describe('Filter by status: running, exited, failed, or cancelled.'),
        limit: z.number().optional().describe('Maximum jobs to return. Defaults to 100.'),
      },
    },
    async (input) => {
      try {
        const list = await jobs.list(input.status, input.limit ?? 100);
        return jsonResult({ ok: true, jobs: list, count: list.length });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
