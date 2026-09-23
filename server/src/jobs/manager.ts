import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import { createWriteStream, type WriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getConfig } from '../config/index.js';
import type { JobRecord } from '../core/adapter.js';

export interface JobStartOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  shell: 'exec' | 'powershell';
}

export interface JobOutputResult {
  chunk: string;
  nextOffset: number;
  eof: boolean;
  truncated: boolean;
}

interface JobEntry {
  child: ChildProcess;
  record: JobRecord;
  markCancelled: () => void;
}

/**
 * JobManager runs long-lived, detached processes for work that exceeds
 * Copilot Studio's ~2 minute request timeout. Callers `start()` a job, then
 * poll `status()`/`output()` until it finishes, or `cancel()` it.
 *
 * Job state is persisted to `<JOB_DIRECTORY>/<jobId>/status.json` so
 * `status`/`list` keep working across a service restart, even though the
 * underlying process itself does not survive a restart.
 */
export class JobManager {
  private jobs = new Map<string, JobEntry>();

  private jobDir(jobId: string): string {
    return path.join(getConfig().JOB_DIRECTORY, jobId);
  }

  private async writeStatus(record: JobRecord): Promise<void> {
    const dir = this.jobDir(record.jobId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify(record, null, 2), 'utf8');
  }

  private async readStatus(jobId: string): Promise<JobRecord | undefined> {
    try {
      const raw = await fs.readFile(path.join(this.jobDir(jobId), 'status.json'), 'utf8');
      return JSON.parse(raw) as JobRecord;
    } catch {
      return undefined;
    }
  }

  async start(opts: JobStartOptions): Promise<JobRecord> {
    const cfg = getConfig();
    const jobId = crypto.randomUUID();
    const dir = this.jobDir(jobId);
    await fs.mkdir(dir, { recursive: true });

    const stdoutPath = path.join(dir, 'stdout.log');
    const stderrPath = path.join(dir, 'stderr.log');
    const stdoutStream: WriteStream = createWriteStream(stdoutPath, { flags: 'a' });
    const stderrStream: WriteStream = createWriteStream(stderrPath, { flags: 'a' });

    const env = opts.env ? { ...process.env, ...opts.env } : process.env;

    let child: ChildProcess;
    let recordArgs: string[] = opts.args ?? [];
    if (opts.shell === 'powershell') {
      const psArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'];
      child = spawn(cfg.POWERSHELL_PATH, psArgs, {
        cwd: opts.cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: false,
      });
      child.stdin?.write(opts.command);
      child.stdin?.end();
      recordArgs = psArgs;
    } else {
      child = spawn(opts.command, opts.args ?? [], {
        cwd: opts.cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: false,
      });
    }

    child.stdout?.pipe(stdoutStream);
    child.stderr?.pipe(stderrStream);

    const record: JobRecord = {
      jobId,
      command: opts.command,
      args: recordArgs,
      cwd: opts.cwd,
      shell: opts.shell,
      pid: child.pid,
      status: 'running',
      startedAt: new Date().toISOString(),
      stdoutPath,
      stderrPath,
    };

    let cancelled = false;
    const entry: JobEntry = { child, record, markCancelled: () => { cancelled = true; } };
    this.jobs.set(jobId, entry);

    await this.writeStatus(record);

    // 'close' fires once the output streams have finished (pipe() ends the log files), so the
    // last lines are never lost and late output is never written to an ended stream.
    child.on('close', (code) => {
      entry.record.exitCode = code;
      entry.record.endedAt = new Date().toISOString();
      if (cancelled) {
        entry.record.status = 'cancelled';
      } else {
        entry.record.status = code === 0 ? 'exited' : 'failed';
      }
      void this.writeStatus(entry.record);
    });

    child.on('error', (err) => {
      stderrStream.write(`\n[spawn error] ${err.message}`);
      entry.record.status = 'failed';
      entry.record.endedAt = new Date().toISOString();
      void this.writeStatus(entry.record);
    });

    return record;
  }

  async status(jobId: string): Promise<JobRecord | undefined> {
    const inMemory = this.jobs.get(jobId);
    if (inMemory) return inMemory.record;
    return this.readStatus(jobId);
  }

  async output(
    jobId: string,
    stream: 'stdout' | 'stderr' | 'both',
    offset: number,
    maxBytes: number,
  ): Promise<JobOutputResult> {
    const record = await this.status(jobId);
    if (!record) throw new Error(`Unknown jobId: ${jobId}`);

    if (stream === 'stdout' || stream === 'stderr') {
      return this.readLogWindow(stream === 'stdout' ? record.stdoutPath : record.stderrPath, offset, maxBytes);
    }

    // 'both': apply the same offset to both streams and split the byte budget
    // in half. `nextOffset` is the larger of the two per-stream offsets so a
    // subsequent call keeps advancing both streams toward eof.
    const half = Math.floor(maxBytes / 2);

    const out = await this.readLogWindow(record.stdoutPath, offset, half);
    const err = await this.readLogWindow(record.stderrPath, offset, maxBytes - half);

    const chunk = `--- stdout ---\n${out.chunk}\n--- stderr ---\n${err.chunk}`;
    const nextOffset = Math.max(out.nextOffset, err.nextOffset);
    const eof = out.eof && err.eof;
    const truncated = out.truncated || err.truncated;

    return { chunk, nextOffset, eof, truncated };
  }

  private async readLogWindow(filePath: string, offset: number, maxBytes: number): Promise<JobOutputResult> {
    let handle;
    try {
      handle = await fs.open(filePath, 'r');
    } catch {
      return { chunk: '', nextOffset: offset, eof: true, truncated: false };
    }
    try {
      const stat = await handle.stat();
      const start = Math.min(Math.max(0, offset), stat.size);
      const length = Math.max(0, Math.min(maxBytes, stat.size - start));
      const buf = Buffer.alloc(length);
      if (length > 0) await handle.read(buf, 0, length, start);
      const end = start + length;
      const eof = end >= stat.size;
      return { chunk: buf.toString('utf8'), nextOffset: end, eof, truncated: !eof };
    } finally {
      await handle.close();
    }
  }

  async cancel(jobId: string): Promise<JobRecord> {
    const entry = this.jobs.get(jobId);
    if (!entry) {
      const record = await this.readStatus(jobId);
      if (!record) throw new Error(`Unknown jobId: ${jobId}`);
      if (record.status !== 'running') return record;
      throw new Error(`Job ${jobId} is not tracked by this process instance and cannot be cancelled.`);
    }
    entry.markCancelled();
    try {
      entry.child.kill('SIGKILL');
    } catch {
      // process may already be gone
    }
    entry.record.status = 'cancelled';
    entry.record.endedAt = new Date().toISOString();
    await this.writeStatus(entry.record);
    return entry.record;
  }

  async list(status?: string, limit = 100): Promise<JobRecord[]> {
    const cfg = getConfig();
    const byId = new Map<string, JobRecord>();

    for (const entry of this.jobs.values()) {
      byId.set(entry.record.jobId, entry.record);
    }

    try {
      const dirs = await fs.readdir(cfg.JOB_DIRECTORY, { withFileTypes: true });
      for (const d of dirs) {
        if (!d.isDirectory() || byId.has(d.name)) continue;
        const record = await this.readStatus(d.name);
        if (record) byId.set(d.name, record);
      }
    } catch {
      // job directory may not exist yet
    }

    let records = Array.from(byId.values());
    if (status) records = records.filter((r) => r.status === status);
    records.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
    return records.slice(0, limit);
  }
}
