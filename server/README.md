# Claw server

The MCP server that Claw PC runs on your PC: 14 general-purpose tools (`exec`, `powershell`,
`fs_read`, `fs_write`, `fs_list`, `fs_search`, `fs_op`, `fs_stat`, `job_start`, `job_status`,
`job_output`, `job_cancel`, `job_list`, `system_info`) over MCP Streamable HTTP, protected by an
API key in the `x-api-key` header.

You don't need to do anything in this folder. `claw.ps1` copies it to
`%LOCALAPPDATA%\claw-pc\server`, builds it there and runs it.

## Where it comes from

It's adapted from copilot-studio-claw v0.1.0 (MIT), which runs the same server on a dedicated
Azure VM for Copilot Studio agents. Changes for Claw PC:

- **Safety annotations on every tool**, so Cowork runs reads straight away and asks before
  commands, writes, deletes and jobs.
- **The server keeps its own settings to itself.** After start-up it removes `API_KEY`,
  `API_KEY_HEADER`, `HOST` and `PORT` from its environment, so commands can't read the key and
  apps they start don't pick up the server's port.
- **Background jobs finish on `close` rather than `exit`**, so the last lines of output are
  never lost and late output can't be written to a closed log.
- **Wording for a PC**: tool descriptions say "the machine" rather than "the VM", and point to
  background jobs for anything over about 20 seconds (Claw PC cuts calls off at 25).
- **`scripts/selftest.mjs`**: the end-to-end check used by `claw.ps1 -SelfTest` and CI.

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
