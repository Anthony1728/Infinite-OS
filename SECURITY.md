# Security Policy

## Supported versions

Infinite OS is under active development. Security fixes are applied to the current `main` branch and the latest published release. Older builds may not receive fixes.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting for this repository:

1. Open the **Security** tab of [Anthony5109/Infinite-OS](https://github.com/Anthony5109/Infinite-OS).
2. Choose **Report a vulnerability**.
3. Include the affected version or commit, a description, reproduction steps, and the impact you believe it has.

If private reporting is unavailable, contact the repository owner through GitHub rather than posting details publicly.

Please include:

- The affected component (main process, renderer, browser bridge, extension, PC Live Map, build tooling).
- Steps to reproduce.
- Whether the issue requires a malicious page, a local user, or another account on the same machine.
- Any suggested fix or mitigation.

## What to expect

- Acknowledgement of the report as soon as practical.
- An assessment and, when confirmed, a fix in a private branch.
- Credit in the release notes if you would like it.

## Security model

Infinite OS is a local desktop application with powerful tools. The important boundaries are:

- **Renderer isolation.** The renderer runs with `contextIsolation` enabled and no Node.js integration. Privileged work goes through typed IPC handlers.
- **Browser bridge.** The bridge binds to `127.0.0.1` only and requires a token stored at `~/.infinite-ai/bridge-token`. Treat that file as a credential.
- **Browser extension.** The bundled extension can read and act on pages in the browser profile where it is installed. Install it only in a profile you intend the assistant to control.
- **Desktop automation.** PC Live Map can observe windows, controls, and input state, and can send clicks and keystrokes. Grant it only on machines where that level of access is acceptable.
- **Local data.** Application data is stored under `~/.infinite-ai`. Account profiles are separated by directory and the app relaunches when the active profile changes.
- **Provider credentials.** API keys are stored locally and are sent only to the provider you configure.

## Out of scope

- Vulnerabilities that require an attacker to already have full local code execution or administrative access.
- Issues caused by running untrusted third-party plugins or MCP servers that you installed yourself.
- Reports about a fork or modified build that is not the official repository.

## If a secret was exposed

If you accidentally commit a credential, revoke or rotate it with the provider immediately. Removing it from a later commit does not remove it from git history. Report the exposure privately so the repository history can be cleaned.
