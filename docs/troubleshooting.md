# Troubleshooting

Logs are in `%LOCALAPPDATA%\claw-pc\logs`: `server.err.log`, `caddy.err.log`,
`tunnel.out.log`, `smoke.log` and `selftest.log`. If you share one when asking for help, remove
anything that starts with `cowork-` first: that's your secret.

## Starting Claw PC

| What you see | What to do |
| --- | --- |
| "Please extract the whole zip first" | Right-click the zip, choose **Extract All**, then run `Start-Claw.cmd` from the extracted folder. |
| "Windows protected your PC" | Select **More info → Run anyway**. It's a plain script, so you can read it first. |
| "Please run Start-Claw.cmd normally, not Run as administrator" | Double-click it normally. Claw PC deliberately refuses administrator rights. |
| "winget isn't available" | Install **App Installer** from the Microsoft Store, then try again. |
| "... still isn't available" after an install | Close the window and double-click `Start-Claw.cmd` again so Windows picks up the new app. |
| "Port 38787 (or 38788) is already in use" | Run `.\Start-Claw.cmd -Stop`. If another app is using the port, close it. |
| "Building the server failed" | Check your internet connection (it downloads packages from npm) and try again. |

## Dev tunnel

| What you see | What to do |
| --- | --- |
| Sign-in fails | Try a different account: run `devtunnel user login -g` to use GitHub, then start again. |
| "Couldn't create the dev tunnel" | Your organisation may block dev tunnels or anonymous tunnel access. Try signing in with a personal Microsoft or GitHub account, or ask your IT team. |
| "The tunnel didn't connect" | Check your internet connection. Some company networks block `*.devtunnels.ms`. See `tunnel.out.log`. |
| "The end-to-end test failed" | See `smoke.log`. Stop Claw PC and run `.\Start-Claw.cmd -SelfTest` to check everything locally. |
| "The dev tunnel stopped" after sleep or a network change | Double-click `Start-Claw.cmd` again. |

## Cowork

| What you see | What to do |
| --- | --- |
| No **Upload plugin** option | Your admin may not allow custom plugins. Ask them. |
| Cowork says the plugin already exists | Remove the old one (**Customize → Plugins → Claw PC → Remove**), then upload again. |
| Cowork doesn't use Claw PC | Check the Claw PC window is open and running, start a **new** conversation, check **Claw PC** is on under **Sources**, and say "on my PC" or "on Claw PC" in your request. |
| It worked before, but not after `-Rotate` or reinstalling | The secret URL changed. Upload the new `claw-pc-plugin-READY.zip` (run `.\Start-Claw.cmd -Plugin` if you deleted it). |
| A command stops after 25 seconds | That's deliberate: Cowork expects every call to finish within 30 seconds. Ask Cowork to run it as a background job. |

## Starting again from scratch

```powershell
.\Start-Claw.cmd -Uninstall
.\Start-Claw.cmd
```

This makes a new tunnel, keys and plugin. Remove the old Claw PC plugin in Cowork and upload the
new one.
