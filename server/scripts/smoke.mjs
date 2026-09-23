// Local smoke test: drives the running server with a real MCP client over
// Streamable HTTP. Verifies initialize, tools/list, and an exec round-trip.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.CLAW_URL ?? 'http://127.0.0.1:8787/mcp';
const apiKey = process.env.API_KEY ?? '';

const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: apiKey ? { headers: { 'x-api-key': apiKey } } : undefined,
});

const client = new Client({ name: 'claw-smoke', version: '0.0.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));

const res = await client.callTool({
  name: 'exec',
  arguments: { command: process.platform === 'win32' ? 'cmd' : 'sh', args: process.platform === 'win32' ? ['/c', 'echo hello-from-claw'] : ['-c', 'echo hello-from-claw'] },
});
console.log('EXEC RESULT:', JSON.stringify(res.content, null, 2));

const sys = await client.callTool({ name: 'system_info', arguments: { sections: ['os', 'runtimes'] } });
console.log('SYSINFO:', JSON.stringify(sys.content, null, 2).slice(0, 600));

await client.close();
console.log('SMOKE OK');
