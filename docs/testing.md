# Testing Claw PC

## 1. It tests itself every time it starts

When Claw PC starts, it sends a real request out through the internet and back into your PC
through your tunnel, and runs a command. Look for these two lines:

- **End-to-end test passed.**
- **Claw PC is running.**

For a deeper check that never opens the tunnel, stop Claw PC and run this in a terminal in the
folder:

```powershell
.\Start-Claw.cmd -SelfTest
```

It builds and starts everything locally, checks all 14 tools (commands, PowerShell, files and
background jobs), checks that nothing gets in without the secret path, builds a test plugin and
ends with **SELF-TEST PASSED**. CI runs the same test on every change.

## 2. Check the lock yourself (optional)

With Claw PC running, open a second PowerShell 7 window and run:

```powershell
$s = Get-Content "$env:LOCALAPPDATA\claw-pc\state.json" | ConvertFrom-Json
$h = @{ 'X-Tunnel-Skip-AntiPhishing-Page' = 'true' }

# With the secret: shows status "ok"
Invoke-RestMethod ($s.url -replace '/mcp$', '/health') -Headers $h

# Without the secret: shows 404
(Invoke-WebRequest (($s.url -split '/cowork-')[0] + '/health') -Headers $h -SkipHttpErrorCheck).StatusCode
```

Don't paste the output anywhere: it includes your secret URL.

## 3. Try it in Cowork

1. Upload your plugin if you haven't yet (see [Set it up](../README.md#set-it-up-about-5-minutes)).
2. Start a **new** conversation. Plugins only load in new ones.
3. Check **Claw PC** is switched on under **Sources**, then try these in order:

| # | Ask Cowork | What it proves |
| --- | --- | --- |
| 1 | "On my PC, what versions of Windows, Node and PowerShell do I have?" | The connection works |
| 2 | "On my PC, create hello.txt in my claw workspace with today's date, then read it back." | Writing and reading files |
| 3 | "On my PC, use PowerShell to list the 5 biggest files in my claw workspace." | PowerShell runs |
| 4 | "On my PC, make a folder called demo in my claw workspace and run `npm install express` there as a background job. Tell me when it's done." | Long tasks (over 25 seconds) |
| 5 | "On my PC, show me what's in %LOCALAPPDATA%\claw-pc\state.json." | Safety rules: it should **refuse** |
| 6 | "On my PC, delete hello.txt and the demo folder from my claw workspace." | Clean-up |

Cowork may ask you to approve commands, writes and deletes. That's expected; reads run straight
away.

If something doesn't work, see [troubleshooting](troubleshooting.md).
