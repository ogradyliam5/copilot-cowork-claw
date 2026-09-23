/**
 * MachineAdapter is the seam between MCP tools and the machine they operate.
 *
 * v0.1 ships a WindowsAdapter. Future targets (Windows 365, SSH, Docker,
 * Linux) implement the same interface without touching tool definitions.
 */

export interface ProcessRequest {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutSeconds?: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}

export interface PowerShellRequest {
  script: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutSeconds?: number;
  /** Best-effort request to run elevated (already-Administrator service is a no-op). */
  elevated?: boolean;
}

export type FsEncoding = 'utf8' | 'base64';

export interface FsEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  mtime: string;
}

export interface FsStat {
  exists: boolean;
  type?: FsEntry['type'];
  size?: number;
  mtime?: string;
  attributes?: string[];
}

export type FsOp = 'copy' | 'move' | 'delete' | 'mkdir';

export interface JobRecord {
  jobId: string;
  command: string;
  args: string[];
  cwd?: string;
  shell: 'exec' | 'powershell';
  pid?: number;
  status: 'running' | 'exited' | 'failed' | 'cancelled';
  exitCode?: number | null;
  startedAt: string;
  endedAt?: string;
  stdoutPath: string;
  stderrPath: string;
}

export type SystemInfoSection =
  | 'os'
  | 'hardware'
  | 'disks'
  | 'network'
  | 'ports'
  | 'runtimes'
  | 'processes'
  | 'env';

export interface MachineAdapter {
  runProcess(req: ProcessRequest): Promise<ProcessResult>;
  runPowerShell(req: PowerShellRequest): Promise<ProcessResult>;

  fsRead(path: string, encoding: FsEncoding, offset: number, maxBytes: number): Promise<{ content: string; encoding: FsEncoding; bytesReturned: number; truncated: boolean; eof: boolean }>;
  fsWrite(path: string, content: string, encoding: FsEncoding, mode: 'overwrite' | 'append' | 'create'): Promise<{ bytesWritten: number; path: string }>;
  fsList(path: string, recursive: boolean, glob: string | undefined, maxEntries: number): Promise<{ entries: FsEntry[]; truncated: boolean }>;
  fsSearch(root: string, query: string, isRegex: boolean, glob: string | undefined, maxMatches: number): Promise<{ matches: { path: string; line: number; text: string }[]; truncated: boolean }>;
  fsOp(op: FsOp, path: string, dest: string | undefined, recursive: boolean): Promise<{ ok: boolean; path: string }>;
  fsStat(path: string): Promise<FsStat>;

  systemInfo(sections: SystemInfoSection[]): Promise<Record<string, unknown>>;
}
