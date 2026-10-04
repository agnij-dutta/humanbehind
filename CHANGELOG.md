# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-05

### Added

- `HumanBindingRegistry.sol`: binds an ERC-8004 agent to an anon-aadhaar
  nullifier. Immutable trust anchor checked at deploy, contract-supplied
  nullifier seed, signal and reveal vector, per-human agent cap, owner and
  human revocation, transfer invalidates the binding, gas-capped verifier call.
- `AgentIdentityRegistry.sol`: minimal ERC-8004 identity registry for local and
  testnet use.
- `@humanbehind/core`: ABIs, signal computation, proof packing, a prover that
  runs in Node and in a browser Web Worker, TEST QR minting.
- `@humanbehind/verifier`: `isHumanBacked`, `getHumanBacking`, `evaluate`,
  `verifyCardClaim` for marketplaces. Fails closed and rejects test anchors by
  default.
- Next.js web app: register an agent, mint a TEST QR, prove in the browser,
  bind, public badge page and ERC-8004 registration file per agent.
- `humanBacking` extension proposal for ERC-8004 registration files, with a
  JSON Schema.
- Forge unit tests, real-proof forge tests, package unit tests, a headless
  anvil end-to-end run and a browser end-to-end script.
- CI, lint and format config, contributor and security docs.

### Security

- `verifyCardClaim` now requires the `agentId` and `identityRegistry` you
  resolved yourself and skips entries naming another agent. Before, a card
  could point at a trusted registry entry for somebody else's human-backed
  agent and borrow its badge.
- `isHumanBacked` accepts an optional `identityRegistry` and fails if the
  binding registry serves a different one.

[Unreleased]: https://github.com/agnij-dutta/humanbehind/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/agnij-dutta/humanbehind/releases/tag/v0.1.0
