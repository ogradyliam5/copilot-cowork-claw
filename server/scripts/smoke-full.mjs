// Full smoke test: exercises fs_* and job_* lifecycle in addition to exec.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import os from 'node:os';
import path from 'node:path';

const url = process.env.CLAW_URL ?? 'http://127.0.0.1:8787/mcp';
const apiKey = process.env.API_KEY ?? '';
const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: apiKey ? { headers: { 'x-api-key': apiKey } } : undefined,
});
const client = new Client({ name: 'claw-smoke-full', version: '0.0.0' });
await client.connect(transport);

const parse = (r) => JSON.parse(r.content[0].text);
const call = (name, args) => client.callTool({ name, arguments: args });

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
console.log('TOOLS (' + tools.length + '):', tools.join(', '));

const dir = path.join(os.tmpdir(), 'claw-smoke-' + Date.now());
const file = path.join(dir, 'hello.txt');

console.log('mkdir:', parse(await call('fs_op', { op: 'mkdir', path: dir })).ok);
console.log('write:', parse(await call('fs_write', { path: file, content: 'claw rocks' })).bytesWritten, 'bytes');
console.log('read :', JSON.stringify(parse(await call('fs_read', { path: file })).content));
console.log('stat :', parse(await call('fs_stat', { path: file })).type);
console.log('list :', parse(await call('fs_list', { path: dir })).count, 'entries');

// Job lifecycle: a short powershell loop.
const started = parse(await call('job_start', { command: '1..3 | % { "tick $_"; Start-Sleep -Milliseconds 300 }', shell: 'powershell' }));
console.log('job_start:', started.jobId, started.status);
let status;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 400));
  status = parse(await call('job_status', { jobId: started.jobId }));
  if (status.status !== 'running') break;
}
console.log('job final status:', status.status, 'exit', status.exitCode);
const out = parse(await call('job_output', { jobId: started.jobId, stream: 'stdout' }));
console.log('job_output chunk:', JSON.stringify(out.chunk));

console.log('cleanup:', parse(await call('fs_op', { op: 'delete', path: dir, recursive: true })).ok);
await client.close();
console.log('FULL SMOKE OK');
