# Security policy

This project handles zero-knowledge identity proofs over Indian Aadhaar
credentials and binds them to on-chain agent identities. It is **unaudited**
and has only been run on local chains with **test** Aadhaar data. Do not use it
with real Aadhaar QRs or to gate anything of value yet.

## Reporting a vulnerability

Please report privately through GitHub's private vulnerability reporting:
**Security tab, "Report a vulnerability"** on
https://github.com/agnij-dutta/humanbehind. Do not open a public issue.

Include the affected component, a reproduction (a failing forge or package
test is ideal) and the impact. Never include real Aadhaar QR data, Aadhaar
numbers, photos or private keys in a report; reproduce with the public test
fixtures in `dev-fixtures/`.

You can expect an acknowledgement within 7 days. This is a one-person project,
so fixes are best effort.

## In scope

- `contracts/src/HumanBindingRegistry.sol` and `AgentIdentityRegistry.sol`:
  binding without a valid proof, binding someone else's agent, replaying a
  proof across agent, owner, chain, registry or nonce, choosing or switching
  the trust anchor or nullifier seed, exceeding the per-human cap, blocking or
  forging revocation, revealing more than `ageAbove18`.
- `packages/core`: signal computation that diverges from the contract, a
  prover path that emits a proof revealing more than the policy allows.
- `packages/verifier`: any input that makes `isHumanBacked` or
  `verifyCardClaim` return `true` when the on-chain state or the caller's
  policy says it should not, or that turns an error into `true`.
- `apps/web`: anything that lets a client influence what is trusted, serves
  TEST QRs when `HB_DEV_MODE` is off or against a production-anchored
  registry, or leaks QR data off the user's device.

## Known non-goals (not vulnerabilities)

These are documented limitations, see the README's security model:

- The proof shows possession of a fresh UIDAI-signed QR, not that the holder
  is the person named on it. No liveness or face match.
- A human can hand their agent, wallet or QR to someone else.
- Anyone who has scanned a person's Aadhaar QR can compute their nullifier for
  this registry and find the agents they back.
- A photo update at an enrolment centre yields a new nullifier.
- A test-anchored deployment proves nothing about real people; the verifier
  library rejects it unless `allowTestAnchor` is set.
- The registry trusts the `AnonAadhaar` verifier contract it was deployed
  with. Consumers who pin a registry must also check that deployment.
- Soundness of the anon-aadhaar circuit and its groth16 trusted setup.
