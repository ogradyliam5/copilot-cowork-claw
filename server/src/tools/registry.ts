import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MachineAdapter } from '../core/adapter.js';
import { registerExec } from './exec.js';
import { registerPowerShell } from './powershell.js';
import { registerSystemInfo } from './system-info.js';
import { registerFilesystem } from './fs.js';
import { registerJobs } from './jobs.js';
import { JobManager } from '../jobs/manager.js';

/**
 * Register the full claw tool set on an McpServer instance.
 *
 * Kept small and general-purpose on purpose: agents count every tool against
 * their tool budget, so a few powerful tools beat many narrow ones.
 *
 * The JobManager is a module-level singleton so background jobs survive across
 * the stateless per-request registrations (each MCP request may construct a
 * fresh McpServer, but jobs must persist for the lifetime of the process).
 */
const jobManager = new JobManager();

export function registerAllTools(server: McpServer, adapter: MachineAdapter): void {
  registerExec(server, adapter);
  registerPowerShell(server, adapter);
  registerSystemInfo(server, adapter);
  registerFilesystem(server, adapter);
  registerJobs(server, jobManager);
}
