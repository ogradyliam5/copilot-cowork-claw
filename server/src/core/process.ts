import { spawn, spawnSync } from 'node:child_process';
import { getConfig } from '../config/index.js';
import type { ProcessRequest, ProcessResult, PowerShellRequest } from './adapter.js';

let resolvedPwsh: string | undefined;

/**
 * Resolve the PowerShell executable once. Prefer the configured path
 * (PowerShell 7 / `pwsh`); if that isn't runnable, fall back to Windows
 * PowerShell (`powershell.exe`) so the server still works on a box without
 * PowerShell 7 installed yet.
 */
function resolvePowerShell(): string {
  if (resolvedPwsh) return resolvedPwsh;
  const configured = getConfig().POWERSHELL_PATH;
  const probe = spawnSync(configured, ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
    windowsHide: true,
    timeout: 10_000,
  });
  resolvedPwsh = probe.status === 0 ? configured : 'powershell';
  return resolvedPwsh;
}

/**
 * Run a process with a hard timeout, capturing stdout/stderr into memory
 * (bounded by the caller's truncation at the tool layer). For unbounded /
 * long-running work the job subsystem is used instead.
 */
export function runProcess(req: ProcessRequest): Promise<ProcessResult> {
  const cfg = getConfig();
  const timeoutMs = clampTimeout(req.timeoutSeconds) * 1000;
  const started = Date.now();

  return new Promise((resolve) => {
    const child = spawn(req.command, req.args ?? [], {
      cwd: req.cwd,
      env: req.env ? { ...process.env, ...req.env } : process.env,
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    // Cap in-memory capture generously above the response budget; the tool layer truncates.
    const cap = cfg.MAX_OUTPUT_BYTES * 4;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < cap) stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < cap) stderr += d.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr + `\n[spawn error] ${err.message}`,
        exitCode: null,
        durationMs: Date.now() - started,
        timedOut,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, durationMs: Date.now() - started, timedOut });
    });
  });
}

/** Run a PowerShell 7 script via -Command from stdin-safe encoded argument. */
export function runPowerShell(req: PowerShellRequest): Promise<ProcessResult> {
  const cfg = getConfig();
  // -NoProfile for reproducibility; -Command - reads the script from stdin.
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'];
  const timeoutMs = clampTimeout(req.timeoutSeconds) * 1000;
  const started = Date.now();
  const shell = resolvePowerShell();

  return new Promise((resolve) => {
    const child = spawn(shell, args, {
      cwd: req.cwd,
      env: req.env ? { ...process.env, ...req.env } : process.env,
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cap = cfg.MAX_OUTPUT_BYTES * 4;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < cap) stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < cap) stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + `\n[spawn error] ${err.message}`, exitCode: null, durationMs: Date.now() - started, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, durationMs: Date.now() - started, timedOut });
    });

    child.stdin?.write(req.script);
    child.stdin?.end();
  });
}

export function clampTimeout(requested?: number): number {
  const cfg = getConfig();
  if (!requested || requested <= 0) return cfg.DEFAULT_TIMEOUT_SECONDS;
  return Math.min(requested, cfg.MAX_TIMEOUT_SECONDS);
}
