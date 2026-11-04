# Local agent setup (Ken's desktop, Windows)

What's installed for the JIEN agent team, how to check it, and how to remove it.
Everything here installs into your user profile: no admin rights needed.

## The tools

| Tool | Why | Install (PowerShell) | Check |
|---|---|---|---|
| Node.js 22 + pnpm | Already used for JIEN | — | `node -v` · `pnpm -v` |
| GitHub CLI | Lets Codex and Grok open PRs, comment and read issues | `winget install --id GitHub.cli` then `gh auth login` | `gh --version` · `gh auth status` |
| Codex CLI | Dev agent | `npm install -g @openai/codex` | `codex --version` |
| Grok Build | Tester agent | `irm https://x.ai/cli/install.ps1 \| iex` (xAI's official installer) | `grok --version` |

To see where each one lives:

```powershell
Get-Command gh, codex, grok | Select-Object Name, Source
```

## Updating
```powershell
npm update -g @openai/codex
winget upgrade --id GitHub.cli
# Grok Build updates itself; re-run the installer if it ever stops
```

## Removing
```powershell
npm uninstall -g @openai/codex
winget uninstall --id GitHub.cli
```
For Grok Build, follow xAI's uninstall notes; its config lives in
`%USERPROFILE%\.grok`.

## First run in the repo
```powershell
cd <your JIEN folder>
git pull
codex     # sign in with ChatGPT when asked
grok      # sign in with your grok.com account when asked
```
Both read `AGENTS.md` automatically. Nothing else to configure.

## Build the Android app
1. Install EAS CLI (`npm install -g eas-cli`) and sign in once with `eas login`.
2. In the EAS `preview` environment, configure `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `EXPO_PUBLIC_BASE_URL`; never commit their values.
3. From the repo root, run `eas build -p android --profile preview`.
4. When the build finishes, open its APK link on the Android phone, allow installs from that browser when prompted, and tap **Install**.

## Install log
Add a dated line whenever something is installed or removed.
- 2026-10-18: setup planned (GitHub CLI, Codex CLI, Grok Build)
