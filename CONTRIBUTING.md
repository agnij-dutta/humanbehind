# Contributing

Thanks for looking. Issues and PRs are welcome. Security issues go through
private reporting, see [SECURITY.md](SECURITY.md).

## Dev setup

Requirements: Node 22, pnpm 9 (`corepack enable`), Foundry (`forge`, `anvil`).

```bash
pnpm install
pnpm build:packages            # @humanbehind/core and @humanbehind/verifier -> dist/
cd contracts && forge build && cd ..
node scripts/export-abi.mjs    # writes packages/core/src/abi.ts + scripts/artifacts.json
```

Proving needs the anon-aadhaar circuit artifacts (612 MB zkey) in
`.artifacts/`. Tests do not: the real-proof forge tests use a committed fixture.

```bash
pnpm artifacts                 # downloads wasm, zkey and vkey into .artifacts/
```

## Tests, lint, build

| Command                             | What it runs                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm test`                         | package unit tests, then `forge test`                                                  |
| `cd contracts && forge test`        | registry unit tests (mock verifier) and real-proof tests (real groth16 verifier)       |
| `pnpm test:packages`                | `node:test` suites in `packages/*/test`                                                |
| `pnpm typecheck`                    | `tsc --noEmit` in every workspace (build packages first)                               |
| `pnpm lint`                         | ESLint, zero warnings allowed                                                          |
| `pnpm format` / `pnpm format:check` | Prettier plus `forge fmt`                                                              |
| `cd contracts && forge lint`        | Solidity lint (vendored files and naming lints excluded, see `foundry.toml`)           |
| `pnpm build`                        | packages and the web app                                                               |
| `pnpm e2e`                          | headless full flow on its own anvil (port 8546) with real proofs, about 2 to 4 minutes |
| `pnpm fixture`                      | regenerates `contracts/test/fixtures/real-proof.json` with fresh real proofs           |

CI (`.github/workflows/ci.yml`) runs lint, format check, forge tests, build,
typecheck, package tests, an ABI drift check and the web build.

## Project layout

| Path                | What                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| `contracts/src/`    | `HumanBindingRegistry`, `AgentIdentityRegistry`, vendored anon-aadhaar |
| `contracts/test/`   | forge tests, mocks, real-proof fixture                                 |
| `packages/core`     | ABIs, signal encoding, prover, TEST QR minting                         |
| `packages/verifier` | consumer library (`isHumanBacked`, `verifyCardClaim`)                  |
| `apps/web`          | Next.js app                                                            |
| `scripts/`          | deploy, e2e, fixture generation, ABI export                            |
| `docs/`             | the `humanBacking` ERC-8004 extension and its JSON Schema              |
| `dev-fixtures/`     | public anon-aadhaar test key and UIDAI's fictitious sample QR only     |

## Changing the contract

1. Write the forge test first. Unit tests use `MockAnonAadhaar`, which accepts
   a proof only for the exact public inputs it was registered with, so any
   change to the seed, signal or reveal vector shows up as `InvalidProof`.
2. Run `node scripts/export-abi.mjs` and commit the regenerated `abi.ts` (CI
   fails on drift).
3. If you change `bindSignal` or `revokeSignal`, update `computeBindSignal` /
   `computeRevokeSignal` in `packages/core` and run `pnpm fixture` so the
   real-proof tests and the core signal tests match again.
4. Update the README security model if a trust assumption moved.

## Adding a consumer policy

Policies live in `evaluate()` in `packages/verifier/src/index.ts`. Add an
option to `IsHumanBackedOptions`, push a human-readable reason when it fails,
and add a test in `packages/verifier/test/`. Policies may only make the answer
stricter; anything that can turn `false` into `true` needs a security review.

## Rules

- Never commit real Aadhaar data, photos, Aadhaar numbers or private keys.
  Anvil's well-known dev keys are fine when labeled.
- Nothing on the client or in a request may choose the trust anchor or the
  nullifier seed. These come from the contract.
- Plain commit messages. Keep PRs small.

## Gotchas carried over from zkdir

- `apps/web/next.config.mjs` marks `snarkjs`, `ffjavascript`, `web-worker`,
  `@anon-aadhaar/core` and `@humanbehind/core` as server external packages.
  Bundling them made the TEST QR route hang for minutes on first request.
- Browser proving runs `singleThread: true` in a Web Worker. `proveBinding`
  calls `snarkjs.groth16.fullProve` directly so no `pnpm patch` of
  anon-aadhaar's dist is needed.
- Never let the client pass a nullifier seed (zkdir used `Date.now()`, which
  gave every proof a fresh nullifier and defeated uniqueness).
