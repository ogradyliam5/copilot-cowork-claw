import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from '../tools/registry.js';
import type { MachineAdapter } from '../core/adapter.js';
import { version } from './version.js';

/**
 * Build a fresh McpServer with all tools registered.
 *
 * In stateless Streamable HTTP mode we construct a new server + transport per
 * request, so this factory is called on each POST to /mcp.
 */
export function createMcpServer(adapter: MachineAdapter): McpServer {
  const server = new McpServer(
    { name: 'copilot-studio-claw', version },
    {
      instructions:
        'Operate a dedicated Windows VM. Use system_info before assuming tools exist; use exec/powershell to run commands and install software; use job_* tools for anything that may run longer than a minute.',
    },
  );
  registerAllTools(server, adapter);
  return server;
}
