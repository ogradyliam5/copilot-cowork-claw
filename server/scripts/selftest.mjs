// End-to-end check for Claw PC: every tool, the safety annotations, and the settings the server
// keeps to itself. `claw.ps1 -SelfTest` runs it through the local proxy; CI runs that on Windows.
//
//   CLAW_URL=http://127.0.0.1:38788/cowork-<secret>/mcp node scripts/selftest.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.CLAW_URL;
if (!url) {
  console.error('Set CLAW_URL to the MCP endpoint to test.');
  process.exit(2);
}

const failures = [];
function check(ok, what) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures.push(what);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const client = new Client({ name: 'claw-pc-selftest', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, raw: text };
  }
}

// Tools and their safety annotations
const { tools } = await client.listTools();
check(tools.length === 14, `14 tools are listed (found ${tools.length})`);
const unlabelled = tools.filter((t) => typeof t.annotations?.readOnlyHint !== 'boolean').map((t) => t.name);
check(unlabelled.length === 0, `every tool has safety annotations${unlabelled.length ? ` (missing: ${unlabelled.join(', ')})` : ''}`);
const readOnly = new Set(tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name));
check(readOnly.has('fs_read') && readOnly.has('system_info'), 'reads are marked read-only');
check(!readOnly.has('exec') && !readOnly.has('powershell') && !readOnly.has('fs_op'), 'commands and deletes are not marked read-only');

// Commands, and the settings the server keeps to itself
const env = await call('exec', { command: 'cmd', args: ['/c', 'set'] });
check(env.ok === true, 'exec runs a command');
const leaked = ['API_KEY', 'API_KEY_HEADER', 'HOST', 'PORT'].filter((k) => new RegExp(`^${k}=`, 'im').test(env.stdout ?? ''));
check(leaked.length === 0, `the server's own settings are not passed to commands${leaked.length ? ` (found: ${leaked.join(', ')})` : ''}`);

const ps = await call('powershell', { script: '$PSVersionTable.PSVersion.Major' });
const major = Number.parseInt(String(ps.stdout ?? '').trim(), 10);
check(ps.ok === true && major >= 7, `PowerShell 7 runs scripts (version ${Number.isNaN(major) ? 'unknown' : major})`);

// Files, in the workspace (the server's working directory)
const file = `claw-selftest-${Date.now()}.txt`;
const written = await call('fs_write', { path: file, content: 'hello from claw' });
check(written.ok === true, 'fs_write writes a file');
const read = await call('fs_read', { path: file });
check(read.content === 'hello from claw', 'fs_read reads it back');
const stat = await call('fs_stat', { path: file });
check(stat.exists === true, 'fs_stat finds it');
const removed = await call('fs_op', { op: 'delete', path: file });
check(removed.ok === true, 'fs_op deletes it');

// Background jobs
const job = await call('job_start', { command: 'Start-Sleep -Seconds 1; Write-Output claw-job-ok', shell: 'powershell' });
check(typeof job.jobId === 'string', 'job_start starts a background job');
let status = 'running';
for (let i = 0; i < 40 && job.jobId && status === 'running'; i++) {
  await sleep(500);
  status = (await call('job_status', { jobId: job.jobId })).status;
}
check(status === 'exited', `the job finishes (status: ${status})`);
const output = job.jobId ? await call('job_output', { jobId: job.jobId, stream: 'stdout' }) : {};
check(String(output.chunk ?? '').includes('claw-job-ok'), 'job_output returns everything the job printed');
const listed = await call('job_list', { limit: 5 });
check(Array.isArray(listed.jobs) && listed.jobs.some((j) => j.jobId === job.jobId), 'job_list shows the job');

// Machine info
const info = await call('system_info', { sections: ['os', 'runtimes'] });
check(info.ok === true && Boolean(info.info?.os), 'system_info describes the machine');

await client.close();

if (failures.length > 0) {
  console.error(`\nSELF-TEST FAILED: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll tool checks passed.');
