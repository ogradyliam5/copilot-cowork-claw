import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { runProcess, runPowerShell } from './process.js';
import type {
  MachineAdapter,
  ProcessRequest,
  ProcessResult,
  PowerShellRequest,
  FsEncoding,
  FsEntry,
  FsStat,
  FsOp,
  SystemInfoSection,
} from './adapter.js';

/**
 * WindowsAdapter — the v0.1 implementation of MachineAdapter for a Windows VM.
 * Process/PowerShell execution is delegated to core/process; filesystem and
 * system_info are implemented with Node APIs plus targeted PowerShell probes.
 */
export class WindowsAdapter implements MachineAdapter {
  runProcess(req: ProcessRequest): Promise<ProcessResult> {
    return runProcess(req);
  }

  runPowerShell(req: PowerShellRequest): Promise<ProcessResult> {
    return runPowerShell(req);
  }

  async fsRead(
    filePath: string,
    encoding: FsEncoding,
    offset: number,
    maxBytes: number,
  ): Promise<{ content: string; encoding: FsEncoding; bytesReturned: number; truncated: boolean; eof: boolean }> {
    const handle = await fs.open(filePath, 'r');
    try {
      const stat = await handle.stat();
      const start = Math.min(Math.max(0, offset), stat.size);
      const length = Math.min(maxBytes, stat.size - start);
      const buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, start);
      const eof = start + length >= stat.size;
      return {
        content: encoding === 'base64' ? buf.toString('base64') : buf.toString('utf8'),
        encoding,
        bytesReturned: length,
        truncated: !eof,
        eof,
      };
    } finally {
      await handle.close();
    }
  }

  async fsWrite(
    filePath: string,
    content: string,
    encoding: FsEncoding,
    mode: 'overwrite' | 'append' | 'create',
  ): Promise<{ bytesWritten: number; path: string }> {
    const buf = Buffer.from(content, encoding);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (mode === 'append') {
      await fs.appendFile(filePath, buf);
    } else {
      const flag = mode === 'create' ? 'wx' : 'w';
      await fs.writeFile(filePath, buf, { flag });
    }
    return { bytesWritten: buf.length, path: filePath };
  }

  async fsList(
    dirPath: string,
    recursive: boolean,
    glob: string | undefined,
    maxEntries: number,
  ): Promise<{ entries: FsEntry[]; truncated: boolean }> {
    const re = glob ? globToRegExp(glob) : undefined;
    const entries: FsEntry[] = [];
    let truncated = false;

    const walk = async (dir: string): Promise<void> => {
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      for (const d of dirents) {
        if (entries.length >= maxEntries) {
          truncated = true;
          return;
        }
        const full = path.join(dir, d.name);
        if (!re || re.test(d.name)) {
          try {
            const st = await fs.lstat(full);
            entries.push({
              name: full,
              type: direntType(d),
              size: st.size,
              mtime: st.mtime.toISOString(),
            });
          } catch {
            // unreadable entry; skip
          }
        }
        if (recursive && d.isDirectory()) await walk(full);
      }
    };

    await walk(dirPath);
    return { entries, truncated };
  }

  async fsSearch(
    root: string,
    query: string,
    isRegex: boolean,
    glob: string | undefined,
    maxMatches: number,
  ): Promise<{ matches: { path: string; line: number; text: string }[]; truncated: boolean }> {
    const nameRe = glob ? globToRegExp(glob) : undefined;
    const contentRe = isRegex ? new RegExp(query) : new RegExp(escapeRegExp(query));
    const matches: { path: string; line: number; text: string }[] = [];
    let truncated = false;

    const files: string[] = [];
    const collect = async (dir: string): Promise<void> => {
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      for (const d of dirents) {
        const full = path.join(dir, d.name);
        if (d.isDirectory()) {
          await collect(full);
        } else if (!nameRe || nameRe.test(d.name)) {
          files.push(full);
        }
      }
    };
    try {
      await collect(root);
    } catch {
      // root unreadable
    }

    for (const file of files) {
      if (matches.length >= maxMatches) {
        truncated = true;
        break;
      }
      await new Promise<void>((resolve) => {
        const rl = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
        let lineNo = 0;
        rl.on('line', (line) => {
          lineNo++;
          if (matches.length >= maxMatches) {
            truncated = true;
            rl.close();
            return;
          }
          if (contentRe.test(line)) {
            matches.push({ path: file, line: lineNo, text: line.slice(0, 500) });
          }
        });
        rl.on('close', resolve);
        rl.on('error', () => resolve());
      });
    }

    return { matches, truncated };
  }

  async fsOp(op: FsOp, targetPath: string, dest: string | undefined, recursive: boolean): Promise<{ ok: boolean; path: string }> {
    switch (op) {
      case 'mkdir':
        await fs.mkdir(targetPath, { recursive: true });
        return { ok: true, path: targetPath };
      case 'delete':
        await fs.rm(targetPath, { recursive, force: false });
        return { ok: true, path: targetPath };
      case 'copy':
        if (!dest) throw new Error('copy requires dest');
        await fs.cp(targetPath, dest, { recursive });
        return { ok: true, path: dest };
      case 'move':
        if (!dest) throw new Error('move requires dest');
        await fs.rename(targetPath, dest);
        return { ok: true, path: dest };
      default:
        throw new Error(`unknown op: ${String(op)}`);
    }
  }

  async fsStat(targetPath: string): Promise<FsStat> {
    try {
      const st = await fs.lstat(targetPath);
      const attributes: string[] = [];
      if (st.isSymbolicLink()) attributes.push('symlink');
      if (!st.isFile() && !st.isDirectory()) attributes.push('special');
      return {
        exists: true,
        type: st.isDirectory() ? 'directory' : st.isSymbolicLink() ? 'symlink' : st.isFile() ? 'file' : 'other',
        size: st.size,
        mtime: st.mtime.toISOString(),
        attributes,
      };
    } catch {
      return { exists: false };
    }
  }

  async systemInfo(sections: SystemInfoSection[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    const want = (s: SystemInfoSection) => sections.length === 0 || sections.includes(s);

    if (want('os')) {
      out.os = {
        platform: process.platform,
        release: os.release(),
        hostname: os.hostname(),
        user: os.userInfo().username,
        arch: process.arch,
        uptimeSeconds: Math.round(os.uptime()),
      };
    }
    if (want('hardware')) {
      out.hardware = {
        cpuModel: os.cpus()[0]?.model ?? 'unknown',
        cpuCount: os.cpus().length,
        totalMemBytes: os.totalmem(),
        freeMemBytes: os.freemem(),
      };
    }
    if (want('runtimes')) {
      out.runtimes = { node: process.version };
    }
    if (want('env')) {
      const { redactEnv } = await import('../util/redact.js');
      out.env = redactEnv(process.env);
    }
    // Sections that need OS probes (disks, network, ports, processes) are gathered
    // via PowerShell so they stay accurate on the VM.
    const psSections: SystemInfoSection[] = (['disks', 'network', 'ports', 'processes'] as SystemInfoSection[]).filter(want);
    if (psSections.length > 0) {
      const script = buildSysInfoScript(psSections);
      const res = await runPowerShell({ script, timeoutSeconds: 30 });
      try {
        Object.assign(out, JSON.parse(res.stdout || '{}'));
      } catch {
        out.probeError = res.stderr.slice(0, 2000);
      }
    }
    return out;
  }
}

function buildSysInfoScript(sections: SystemInfoSection[]): string {
  const parts: string[] = ['$o=@{}'];
  if (sections.includes('disks')) {
    parts.push('$o.disks=@(Get-PSDrive -PSProvider FileSystem | Select-Object Name,@{n="usedGB";e={[math]::Round($_.Used/1GB,1)}},@{n="freeGB";e={[math]::Round($_.Free/1GB,1)}})');
  }
  if (sections.includes('network')) {
    parts.push('$o.network=@(Get-NetIPAddress -ErrorAction SilentlyContinue | Where-Object {$_.AddressState -eq "Preferred"} | Select-Object IPAddress,InterfaceAlias,AddressFamily)');
  }
  if (sections.includes('ports')) {
    parts.push('$o.ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess -First 200)');
  }
  if (sections.includes('processes')) {
    parts.push('$o.processes=@(Get-Process | Sort-Object CPU -Descending | Select-Object -First 30 Name,Id,@{n="cpu";e={$_.CPU}},@{n="wsMB";e={[math]::Round($_.WS/1MB,1)}})');
  }
  parts.push('$o | ConvertTo-Json -Depth 4 -Compress');
  return parts.join('\n');
}

function direntType(d: { isDirectory(): boolean; isSymbolicLink(): boolean; isFile(): boolean }): FsEntry['type'] {
  if (d.isSymbolicLink()) return 'symlink';
  if (d.isDirectory()) return 'directory';
  if (d.isFile()) return 'file';
  return 'other';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}
