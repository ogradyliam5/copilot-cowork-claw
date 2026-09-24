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
    { name: 'claw-pc', version },
    {
      instructions:
        'Operate a Windows PC or virtual machine. Use system_info before assuming tools exist; use exec/powershell to run commands and install software; use job_* tools for anything that may take longer than about 20 seconds.',
    },
  );
  registerAllTools(server, adapter);
  return server;
}
