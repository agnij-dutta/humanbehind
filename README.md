# Human Behind the Agent

A real, unique, adult Indian resident proves they own and authorize an AI
agent, revealing zero personal data. The proof is an
[anon-aadhaar](https://github.com/anon-aadhaar/anon-aadhaar) zero-knowledge
proof over the Aadhaar Secure QR, bound on-chain to the agent's
[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) identity.

Agent marketplaces get Sybil resistance ("one human, N agents, accountable")
without holding KYC data:

```ts
await isHumanBacked(agentId, { client, registry }); // true | false
```

> Local and testnet only. Everything in this repo runs on **test** Aadhaar
> data: UIDAI's published sample resident (a fictitious person) re-signed with
> anon-aadhaar's public test key. No real Aadhaar data is used or requested.

## Layout

| Path                                      | What                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts/src/HumanBindingRegistry.sol`  | Binds `agentId -> nullifier, ageAbove18`. Per-human cap, revocation (owner or human), transfer kills the badge.                                               |
| `contracts/src/AgentIdentityRegistry.sol` | Minimal ERC-8004 Identity Registry (ERC-721, `register(agentURI)`), adapted from Capline.                                                                     |
| `contracts/src/vendor/`                   | anon-aadhaar `AnonAadhaar.sol` + generated groth16 `Verifier.sol` (from `@anon-aadhaar/contracts@2.4.3`).                                                     |
| `packages/core`                           | ABIs, signal computation, proof packing, the prover (`/prover`), TEST QR minting (`/testqr`, Node only).                                                      |
| `packages/verifier`                       | The tiny lib for marketplaces: `isHumanBacked`, `getHumanBacking`, `evaluate`, `verifyCardClaim`. viem peer dep only.                                         |
| `apps/web`                                | Next.js 14: connect wallet, register/choose agent, mint TEST QR, prove in a Web Worker, bind, public badge page per agent.                                    |
| `scripts/`                                | `prove-fixture.ts` (real proofs for forge tests), `deploy.ts`, `e2e-anvil.ts` (headless full flow), `browser-e2e.mjs` (drives the real UI), `minor-check.ts`. |
| `docs/agent-card-extension.md`            | The `humanBacking` field proposal for ERC-8004 registration files + JSON Schema.                                                                              |
| `dev-fixtures/`                           | Public test key + UIDAI sample QR. Not secrets; see its README.                                                                                               |

## How a binding works

```
owner wallet ── register(agentURI) ──> ERC-8004 IdentityRegistry  (agentId)
     │
     ├─ read registry.bindSignal(agentId, owner)      = keccak(domain, chainid, registry,
     │  read registry.nullifierSeed()                         identityRegistry, agentId, owner, nonce)
     │
     ├─ browser: anon-aadhaar groth16 proof over the Secure QR
     │     public: nullifier, timestamp, ageAbove18=1, gender=0, pincode=0, state=0,
     │             nullifierSeed, keccak(signal)>>3
     │
     └─ registry.bind(agentId, nullifier, timestamp, proof)
           checks: caller owns agentId · timestamp fresh · groth16 verifies with the
           CONTRACT's seed, signal and reveal vector · human under the per-human cap
```

Design choices that matter:

- **The trust anchor is not a parameter.** The anon-aadhaar verifier stores the
  RSA key hash as an immutable; the registry reads it once at deploy, exposes
  `isTestAnchor()`, and its constructor refuses to deploy if the anchor is not
  what the deployer declared, or is neither the UIDAI nor the test key. This is
  the fix for the zkdir bug where the server trusted a client-sent
  `useTestAadhaar` flag and anyone could forge proofs with the public test key.
  `RealProof.t.sol::test_real_testProofRejectedByProductionDeployment` proves a
  real test-key proof fails on a production-anchored deployment.
- **The contract supplies the seed, the signal and the reveal vector.** The
  caller only passes `nullifier`, `timestamp` and the proof. So a user can't
  pick another nullifier seed to get a fresh identity, can't reuse a proof for
  another agent/chain/registry, and can't submit a proof that reveals gender,
  state or pincode (it simply won't verify).
- **Nonce in the signal.** Every bind/revoke bumps `nonceOf[agentId]`, so a
  proof that was public in calldata can't be replayed after a revoke.
- **Transfer kills the badge.** `isHumanBacked` requires the current NFT owner
  to equal the address that bound it.
- **Human-initiated revocation.** `revokeByHuman` takes a fresh proof from the
  same human (same nullifier) over `revokeSignal(agentId)`. Anyone can relay
  it, so a human whose wallet was stolen can still pull their name off the agent.
- **Gas cap on verification.** A malformed proof makes the pairing precompile
  eat all forwarded gas (we measured ~1B gas in a test). The verifier call is
  capped at 1M gas.

## Quickstart (local)

Requires Foundry, Node 22, pnpm.

```bash
pnpm install
pnpm --filter @humanbehind/core --filter @humanbehind/verifier build

# circuit artifacts (612 MB zkey) into .artifacts/ (gitignored)
mkdir -p .artifacts && cd .artifacts
B=https://anon-aadhaar-artifacts.s3.eu-central-1.amazonaws.com/v2.0.0
curl -O $B/aadhaar-verifier.wasm -O $B/circuit_final.zkey -O $B/vkey.json && cd ..

# contracts: unit tests (mock verifier) + real-proof tests (real groth16 verifier)
cd contracts && forge build && forge test && cd ..
node scripts/export-abi.mjs              # after any contract change

# headless end-to-end (spawns its own anvil on :8546, ~4 min of proving)
pnpm e2e

# web app
anvil &                                  # :8545
pnpm tsx scripts/deploy.ts               # writes deployments/local.json + apps/web/.env.local
pnpm --filter web link-artifacts         # hard-links .artifacts into public/ (no copy)
pnpm --filter web build && pnpm --filter web start   # http://localhost:3100
```

Regenerate the real-proof fixture (proofs embed fresh QR timestamps; the forge
test warps to them, so the committed fixture keeps working):

```bash
pnpm fixture
```

## What was verified, and how

| Claim                       | Evidence                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Registry logic              | 27 forge tests with a mock verifier that accepts only exact public inputs: replay across agent/chain/registry, other seed, leaky reveal vector, minor, expiry, future timestamp, cap across wallets, transfer, prune, owner and human revocation, anchor checks, verifier revert fails closed, fuzz.         |
| Real proofs verify on-chain | 8 forge tests against the real anon-aadhaar groth16 verifier with real proofs from `pnpm fixture`: bind, human revoke, wrong agent, tampered proof, forged nullifier, second human, **test proof rejected by a production-anchored deployment**, expiry.                                                     |
| Full flow on a chain        | `pnpm e2e`: deploy on anvil, register agent, on-chain `bindSignal` equals off-chain computation, real proof, bind, verifier lib (strict = false for test anchor, true with `allowTestAnchor`), card claim against trusted vs untrusted registry, Sybil cap = 2 across two wallets, transfer drops the badge. |
| The real web UI             | `scripts/browser-e2e.mjs` drove headless Chromium through the actual app: anvil dev wallet, register, mint TEST QR, prove in a Web Worker, bind, agent page shows the badge.                                                                                                                                 |
| Minors can't bind           | `scripts/minor-check.ts`: a DOB-2015 TEST QR yields `ageAbove18 = 0`, the prover refuses to emit a submittable proof (and the contract's hardcoded reveal vector would reject it anyway).                                                                                                                    |

Measured on an Apple M4 (10 cores), Node 22:

|                                                                         | time                                      |
| ----------------------------------------------------------------------- | ----------------------------------------- |
| Node, single-thread                                                     | 195 s                                     |
| Node, multi-thread                                                      | 73 to 105 s (5 runs)                      |
| Browser (headless Chromium, Web Worker, single-thread, local artifacts) | 123.5 s                                   |
| `bind` gas incl. groth16 verify                                         | ~375k (forge), 405,920 estimated on anvil |

## Threat model

### What a live binding proves

- At bind time, someone **holding a UIDAI-signed Aadhaar Secure QR** produced a
  proof for exactly this agent, this owner wallet, this chain and this registry.
- The QR's date of birth is 18+ **as of the QR's signing time**.
- The QR was signed within `maxProofAge` (default 1 day) of binding. UIDAI signs
  the timestamp, so it can't be backdated or forward-dated.
- Within this registry, that QR's holder backs at most `maxAgentsPerHuman` live
  agents, regardless of how many wallets they use.
- The agent token has not changed hands since.

### What it does not prove

- **That the person is the Aadhaar holder.** The circuit proves possession of a
  signed QR, not presence of the person. Freshness helps: an old printout or a
  hotel's photocopy carries an old timestamp and is rejected. A fresh QR needs
  the mAadhaar app or a resident-portal download, both gated by an OTP to the
  registered mobile. So "fresh QR" roughly means "controls the registered mobile
  number today", nothing stronger. No liveness, no face match.
- **That the human still controls the agent.** The binding follows the wallet
  key. Selling the NFT drops the badge; selling the private key does not. A
  human can also operate the agent for someone else ("rent-a-human"). The
  per-human cap bounds how many agents one Aadhaar can lend its name to; it
  does not stop lending. `maxBindingAgeSec` in the verifier lib lets
  marketplaces force periodic re-proof.
- **Real-world identity or recourse.** "Accountable" is pseudonymous: the
  registry can tell "these 3 agents share a human", not who that human is.

### Privacy and linkability

- **On-chain data per binding:** nullifier, QR timestamp (hour precision, i.e.
  when you downloaded your QR), owner address. Name, Aadhaar number, gender,
  state, pincode and photo are never revealed; the reveal vector is fixed in
  the contract.
- **Within one registry, all agents of a human are linkable** via the
  nullifier. That is the point of "one human, N agents".
- **Across apps**, nullifiers differ (different `nullifierSeed`), so two apps
  can't join their users by nullifier alone.
- **Anyone who has ever scanned your QR can find your agents.** The anon-aadhaar
  nullifier is a hash of the seed and the QR photo. Hotels, SIM shops and
  landlords routinely scan Aadhaar QRs. Any of them can compute your nullifier
  for this registry (the seed is public) and list every agent you back. This is
  inherent to deterministic nullifiers over data that third parties hold.
- **Photo updates mint new humans.** The nullifier is `hash(seed, photo)` (circuit `helpers/nullifier.circom`), so a
  biometric/photo update at an enrolment centre yields a new nullifier and a
  fresh set of slots. Expensive and slow, but a real Sybil path.
- A wallet address bound to a nullifier is itself linkable to everything else
  that wallet does. Use a dedicated owner wallet.

### Trust assumptions

- **UIDAI's signing key** and the anon-aadhaar **circuit + groth16 trusted
  setup** (PSE ceremony). A circuit soundness bug breaks everything here.
- **Trust anchor.** The test key is public, so a test-anchored registry proves
  nothing about real people. Mitigations: anchor immutable and checked at
  deploy; `isTestAnchor()` on-chain; `@humanbehind/verifier` treats test anchors
  as not human-backed unless `allowTestAnchor: true`; the badge page labels test
  bindings; the TEST-QR endpoint is gated on the server-only `HB_DEV_MODE` and
  refuses to serve against a production-anchored registry.
- **UIDAI key rotation.** UIDAI published a new offline-KYC certificate dated
  17-02-2026 (shipped in `@anon-aadhaar/react`). `AnonAadhaar.sol` stores a
  single key hash and our `PRODUCTION_PUBKEY_HASH` is the 2021 key, so QRs
  signed with the new key will not verify on a 2021-anchored deployment. A
  production version needs a verifier per anchor and a registry that accepts a
  fixed set (still not caller-selectable).
- **Admin** can change the per-human cap and the max proof age (bounded to 30
  days). Admin cannot change the anchor or seed, or touch bindings. A
  compromised admin can raise the cap and weaken Sybil resistance; put it
  behind a multisig/timelock in anything real.
- **No server in the trust path.** The web server mints test QRs (dev only) and
  renders read-only pages from chain state. A compromised server could lie on
  its HTML; marketplaces should call the chain through the verifier lib.
- **Agent cards are untrusted.** A card can point at a fake registry that
  always says yes. Consumers pin the registry address.
- **Front-running.** `bind` requires `msg.sender == ownerOf(agentId)` and the
  signal includes the owner, so a mempool observer can't use a pending proof.
  `revokeByHuman` is intentionally relayable; the nonce stops replays.
- **Regulatory.** Offline Aadhaar verification by a business has its own rules
  (UIDAI offline verification regulations, DPDP Act). This repo does not store
  Aadhaar numbers or QR data, but check the current regulatory position before
  any production use. Not legal advice.

## zkdir lessons applied

- `serverComponentsExternalPackages: ['snarkjs', 'ffjavascript', 'web-worker',
'@anon-aadhaar/core', '@humanbehind/core']` in `apps/web/next.config.mjs`. The
  dev TEST-QR route imports `@anon-aadhaar/core`, which imports snarkjs at
  top level. The route responds immediately; no 277 s hang.
- Browser proving runs `singleThread: true` inside a Web Worker. We call
  `snarkjs.groth16.fullProve(…, { singleThread })` directly in
  `packages/core/src/prover.ts`, so the zkdir `pnpm patch` of anon-aadhaar's
  dist is no longer needed.
- No client flag selects the trust anchor anywhere: not in the contract, not in
  the server route, not in the verifier lib.
- zkdir also passed `nullifierSeed={Date.now()}` from the client, which gives
  every proof a fresh nullifier and defeats uniqueness. Here the seed is an
  immutable of the registry, read from chain by the client.

## TODO

- Production QR path: QR image upload/scan, UIDAI cert selection, multi-anchor
  registry for the 2021 and 2026 UIDAI keys.
- Chunked zkey loading (anon-aadhaar's localforage chunks) so the browser does
  not hold a 612 MB buffer, plus caching across sessions.
- ERC-8004 Validation Registry bridge (post `validationResponse` with tag
  `human-backed` on bind/revoke).
- Admin behind a timelock; events indexer for the agent page.
- Deploy to a testnet (Fuji / Sepolia) with the test anchor; `contracts/script/Deploy.s.sol` is ready but has only been dry-run locally.
