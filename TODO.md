# TODO - Launch & Control Browser Automation

## Step 1 — Implement real BrowserAgent (Playwright)
- [x] Replace stub methods in `src/main/agent/browser.ts`
- [ ] Keep going (add UI + screenshot transport + tests)


- [ ] Maintain per-session Playwright `browser/context/page`
- [ ] Implement navigate/click/type/screenshot/extract/fillForm with timeouts
- [ ] Decide screenshot transport format (base64 preferred)
- [ ] Add structured error handling

## Step 2 — Validate IPC payloads
- [ ] Ensure `src/main/ipc/browser.ts` compiles with new return shapes
- [ ] Confirm `src/shared/ipc.ts` contracts still match

## Step 3 — Minimal real-time UI
- [ ] Add a small React component to control browser (URL + actions)
- [ ] Display last snapshot + rendered screenshot
- [ ] Wire component into `src/renderer/App.tsx`

## Step 4 — Add e2e test
- [ ] Create a Playwright test that uses BrowserAgent IPC or a pure unit style harness
- [ ] Validate navigation + element interaction + screenshot non-empty

## Step 5 — Run checks
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test:e2e`
- [ ] Smoke test via `pnpm dev`

