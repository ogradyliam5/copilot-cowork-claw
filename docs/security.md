# Security

Claw PC is deliberately powerful. Please read this before you use it.

## What Cowork can do

While Claw PC is running, Cowork can do anything **the Windows account running it** can do on
that machine: read and change files, run programs, and use anything that account is signed in to
from the command line (Git, cloud CLIs and so on). So can anyone who has your secret URL.

## Use a virtual machine (recommended)

The simplest way to limit that reach is to run Claw PC somewhere it can't reach anything
important.

- **A virtual machine (best):** run Claw PC inside a Hyper-V virtual machine (built into the Pro,
  Enterprise and Education editions of Windows 10 and 11), an Azure VM or a Windows 365 Cloud PC.
  Everything Cowork does stays inside the VM.
  - Only sign in to what Cowork's tasks need, for example a GitHub token limited to the repos it
    should touch.
  - Keep personal and sensitive files off the VM.
  - Take a checkpoint or snapshot once it's set up, so you can roll back.
- **A separate Windows account (if you use your own PC):** create a standard (not administrator)
  local account just for Claw PC, and run it while signed in as that account. Cowork then can't
  see your main account's files.

## How it's protected

| Protection | What it does |
| --- | --- |
| Never administrator | `claw.ps1` refuses to run elevated, so Cowork only gets your normal user rights. If a Windows "Do you want to allow this app to make changes?" prompt appears that you didn't expect, select **No**. |
| Secret URL | Cowork reaches your PC only through an unguessable 192-bit secret path. Every other request gets a 404. |
| The API key never leaves your PC | Cowork plugins can't send API keys yet, so the local proxy (Caddy) adds the server's key itself. The server rejects anything without it. |
| Nothing listens on your network | The server and proxy only listen on localhost. The dev tunnel connects outwards, so no router or firewall ports are opened. |
| Secrets stay on your PC | Keys, the tunnel ID and the plugin ID are created on your PC the first time it runs, and kept in `%LOCALAPPDATA%\claw-pc`. Nothing secret is in this repo. |
| Settings stay out of commands | The server removes its API key and port settings from its own environment, so commands it runs can't read them. |
| Approvals | Every tool is marked read-only or not, so Cowork runs reads straight away and asks before commands, writes, deletes and jobs. Cowork is still rolling this out for non-Microsoft plugins, so you might not see prompts yet. |
| Guidance for Cowork | The plugin's skill tells Cowork to work in `%USERPROFILE%\claw-workspace`, stay away from credentials and personal data, and ask before system-wide changes. This guides Cowork; it isn't a hard barrier. |
| Only on when you want it | Claw PC only runs while its window is open. |

## What it can't protect against

- **Anyone with your secret URL has full access.** Keep the plugin private (**Only you**), don't
  share screenshots of it, and delete `claw-pc-plugin-READY.zip` after uploading. If you think the
  URL has leaked, run `.\Start-Claw.cmd -Rotate` straight away and upload the new plugin.
- **Prompt injection.** A web page, document or email that Cowork reads could contain
  instructions that try to make it run commands. The skill tells Cowork to treat that text as
  data, and approvals help, but check what Cowork is about to run.
- **The relay can see your traffic.** Microsoft dev tunnels end the HTTPS connection at the relay
  and forward requests to your PC. Don't use Claw PC for anything you wouldn't send through a
  Microsoft cloud service.
- **Mistakes.** Like any assistant, Cowork can get things wrong. Keep backups of anything
  important.

## Turning it off

- **Stop:** press Ctrl+C or close the Claw PC window.
- **New secret URL:** `.\Start-Claw.cmd -Rotate`, then upload the new plugin.
- **Remove everything:** `.\Start-Claw.cmd -Uninstall`, then remove the plugin in Cowork
  (**Customize → Plugins → Claw PC → Remove**).

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
