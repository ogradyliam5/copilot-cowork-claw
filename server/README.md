# Claw server

The MCP server that Claw PC runs on your Windows machine: 14 general-purpose tools (`exec`,
`powershell`, `fs_read`, `fs_write`, `fs_list`, `fs_search`, `fs_op`, `fs_stat`, `job_start`,
`job_status`, `job_output`, `job_cancel`, `job_list`, `system_info`) over MCP Streamable HTTP,
protected by an API key in the `x-api-key` header.

You don't need to do anything in this folder. `claw.ps1` copies it to
`%LOCALAPPDATA%\claw-pc\server`, builds it there and runs it.

## How it's built

- **A few general tools, not dozens of narrow ones.** Commands, PowerShell, files, background jobs
  and machine info cover almost any task, and Cowork can install anything else it needs.
- **Safety annotations on every tool**, so Cowork runs reads straight away and asks before
  commands, writes, deletes and jobs.
- **The server keeps its own settings to itself.** After start-up it removes `API_KEY`,
  `API_KEY_HEADER`, `HOST` and `PORT` from its environment, so commands can't read the key and
  apps they start don't pick up the server's port.
- **Background jobs for anything slow.** `claw.ps1` stops `exec` and `powershell` calls after 25
  seconds, because Cowork expects every call to finish within 30. Jobs keep running, save their
  output to log files, and finish only once all their output is written.
- **Stateless HTTP.** Each MCP request gets a fresh server instance; background jobs live in a
  shared job manager, so they outlast any single request.
- **`scripts/selftest.mjs`** checks every tool end to end. `claw.ps1 -SelfTest` and CI run it.

## Working on it

```powershell
cd server
npm ci
npm run build
$env:API_KEY = 'dev'; npm start          # MCP endpoint: http://127.0.0.1:8787/mcp
```

Then, in another window, check it end to end:

```powershell
$env:API_KEY = 'dev'; node scripts/smoke.mjs
```

Keep tool input schemas flat (no `$ref`) and give every new tool safety annotations.
