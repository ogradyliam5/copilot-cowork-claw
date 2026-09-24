import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MachineAdapter, SystemInfoSection } from '../core/adapter.js';
import { jsonResult } from './result.js';

const VALID_SECTIONS: SystemInfoSection[] = ['os', 'hardware', 'disks', 'network', 'ports', 'runtimes', 'processes', 'env'];

/**
 * system_info — one tool with a `sections` filter (rather than many small tools)
 * to conserve the agent's tool budget. Enums are validated server-side because
 * some MCP clients treat enum inputs as free strings.
 */
export function registerSystemInfo(server: McpServer, adapter: MachineAdapter): void {
  server.registerTool(
    'system_info',
    {
      title: 'Inspect the machine',
      annotations: { title: 'Inspect the machine', readOnlyHint: true, openWorldHint: false },
      description:
        'Return structured information about the machine. Choose sections: os, hardware, disks, network, ports, runtimes, processes, env. Omit sections to get the lightweight default set. Use this before assuming a tool or dependency exists.',
      inputSchema: {
        sections: z
          .array(z.string())
          .optional()
          .describe(`Any of: ${VALID_SECTIONS.join(', ')}. Unknown values are ignored. Omit for a default summary.`),
      },
    },
    async (input) => {
      const requested = (input.sections ?? []).filter((s): s is SystemInfoSection =>
        (VALID_SECTIONS as string[]).includes(s),
      );
      // Default lightweight set when nothing valid was requested.
      const sections = requested.length > 0 ? requested : (['os', 'hardware', 'runtimes'] as SystemInfoSection[]);
      const info = await adapter.systemInfo(sections);
      return jsonResult({ ok: true, sections, info });
    },
  );
}
