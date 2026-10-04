**What and why**

**How it was tested**

- [ ] `pnpm lint && pnpm format:check`
- [ ] `cd contracts && forge test`
- [ ] `pnpm test:packages && pnpm typecheck`
- [ ] Contract change: ran `node scripts/export-abi.mjs` and updated the threat model if trust assumptions moved
- [ ] No real Aadhaar data, personal data or keys added
