# Contributing to Infinite OS

Thanks for taking the time to improve Infinite OS. This guide covers the local workflow, the checks a change must pass, and the rules that keep the project safe to publish.

## Before you start

- Read the [LICENSE](LICENSE). Infinite OS is source-available and ownership-retaining. By contributing, you agree to the contribution terms in that license.
- Search existing issues and pull requests before opening a new one.
- For large features or architectural changes, open an issue first so the approach can be discussed.

## Development setup

```bash
corepack enable
git clone https://github.com/Anthony5109/Infinite-OS.git
cd Infinite-OS
pnpm install
pnpm run dev
```

Node.js 20.19 or newer is required. The browser bridge is optional for most work; see the README for setup.

## What to run before opening a pull request

```bash
pnpm run typecheck   # main, renderer, and e2e TypeScript projects
pnpm test            # Vitest unit and integration tests
pnpm run build       # production bundle
```

For changes that touch the browser bridge or desktop automation, also run the relevant Playwright suite:

```bash
pnpm run test:e2e
```

Live network tests are opt-in and should stay that way:

```bash
INFINITE_LIVE=1 pnpm exec vitest run src/main/bridge/live-web.test.ts
```

## Code style

- TypeScript everywhere. Prefer explicit types at module boundaries.
- Follow the existing structure: main-process code in `src/main`, renderer code in `src/renderer`, shared contracts in `src/shared`.
- Keep privileged operations in the main process behind typed IPC handlers. Do not give the renderer direct Node.js access.
- Use the existing tool registry and safety checks for new agent capabilities.
- Run `pnpm run format` for touched files, and keep diffs focused.

## Tests

- Add or update tests for behavior changes.
- Unit tests must not read or write the real `~/.infinite-ai` directory. Use the existing temporary-home helpers.
- Never commit a test that depends on a personal account, API key, machine path, or live third-party credential.

## Security and privacy rules

- **Never commit secrets.** No API keys, tokens, passwords, cookies, private keys, or `.env` files with real values.
- **Never commit personal data.** No real names, email addresses, phone numbers, customer records, business data, activity logs, or screenshots containing personal information.
- **No machine-specific paths.** Use `os.homedir()`, `app.getPath()`, or environment variables instead of hardcoded user directories.
- The browser bridge token is generated locally and must never be checked in.
- If you believe a secret has been committed, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Commit and pull request guidance

- Write clear, imperative commit messages.
- Keep pull requests scoped to one change where possible.
- Describe what changed, why it changed, and how you verified it.
- Link related issues.
- Expect review comments about security boundaries and account isolation for anything that touches storage, auth, IPC, or automation.

## License for contributions

By submitting a contribution, you confirm that you have the right to submit it and you grant Anthony Matthews and the Infinite OS project the rights described in the [LICENSE](LICENSE). You retain ownership of work you independently own, but contributing does not transfer ownership of the project or its branding.
