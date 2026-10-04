# @humanbehind/core

Shared pieces for Human Behind the Agent: contract ABIs, the signal encoding
`HumanBindingRegistry` expects, groth16 proof packing, an anon-aadhaar prover
for Node and browsers, and TEST QR minting.

| Entry point                | Exports                                                                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@humanbehind/core`        | `humanBindingRegistryAbi`, `agentIdentityRegistryAbi`, `computeBindSignal`, `computeRevokeSignal`, `anonAadhaarSignalHash`, `packGroth16Proof`, `proofToJson`, `proofFromJson`, `TEST_PUBKEY_HASH`, `PRODUCTION_PUBKEY_HASH` |
| `@humanbehind/core/prover` | `proveBinding`, `verifyBindingProofOffchain`, `PolicyError`                                                                                                                                                                  |
| `@humanbehind/core/testqr` | `mintTestQr` (Node only; signs with the PUBLIC anon-aadhaar test key)                                                                                                                                                        |

Read the signal and nullifier seed from the registry (`bindSignal(agentId, owner)`,
`nullifierSeed()`) and pass them to `proveBinding`. The `compute*` helpers exist
for cross-checks and tests.

Proving needs the anon-aadhaar v2.0.0 circuit artifacts (`pnpm artifacts` at
the repo root). See the [project README](../../README.md). MIT.
