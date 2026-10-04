# ERC-8004 extension proposal: `humanBacking`

Status: proposal, implemented in this repo for local and testnet use.

## Motivation

ERC-8004 gives an agent an on-chain identity (an ERC-721 in the Identity
Registry) and a registration file. It says nothing about _who_ is accountable
for the agent. Marketplaces that want Sybil resistance today either do KYC
(and hold personal data) or do nothing.

`humanBacking` lets a registration file point to an on-chain attestation that
a **unique, adult human** controls the agent, proven with an anon-aadhaar
zero-knowledge proof. No personal data is revealed or stored.

## Registration file

Add `"human-backed"` to `supportedTrust` and a `humanBacking` array:

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "my-trading-agent",
  "description": "...",
  "image": "https://example.com/agent.png",
  "services": [{ "name": "A2A", "endpoint": "https://agent.example/.well-known/agent-card.json", "version": "0.3.0" }],
  "x402Support": true,
  "active": true,
  "registrations": [{ "agentId": 42, "agentRegistry": "eip155:43113:0xIdentityRegistry" }],
  "supportedTrust": ["reputation", "human-backed"],
  "humanBacking": [
    {
      "type": "humanbehind/anon-aadhaar-binding-v1",
      "bindingRegistry": "eip155:43113:0xHumanBindingRegistry",
      "agentId": 42,
      "claims": ["unique-human", "age-over-18"],
      "trustAnchor": "uidai-offline-kyc",
      "check": "isHumanBacked(uint256)"
    }
  ]
}
```

JSON Schema: [`humanBacking.schema.json`](./humanBacking.schema.json).

## Semantics

`isHumanBacked(agentId) == true` on a `HumanBindingRegistry` means:

1. A groth16 proof verified against the anon-aadhaar circuit, under the
   registry's immutable trust anchor (UIDAI production key, or the public
   test key: check `isTestAnchor()`).
2. The proof committed to `(chainid, registry, identityRegistry, agentId,
owner, nonce)`, so it was made for this agent and this owner.
3. The proof revealed exactly `ageAbove18 = 1` and nothing else
   (gender, state, pincode hidden; enforced by the contract).
4. The proof's nullifier (per-registry pseudonymous human id) backs at most
   `maxAgentsPerHuman` live agents.
5. The agent NFT is still held by the address that bound it.

## Verifier rules (normative for consumers)

- **Pin the registry.** Take the binding registry address from your own
  config. The card is a hint; a card can point at a contract that always
  returns `true`. `@humanbehind/verifier`'s `verifyCardClaim` ignores entries
  whose registry is not in `trustedRegistries`.
- **Reject test anchors in production.** `isHumanBacked()` from
  `@humanbehind/verifier` returns `false` for a test-anchored registry unless
  `allowTestAnchor: true` is passed.
- **Read state, not events.** Bindings are revocable and die on transfer.
- **Optionally tighten policy**: `maxAgentsPerHuman: 1` for "this human has no
  other agents here", `maxBindingAgeSec` to force periodic re-proof.

```ts
import { isHumanBacked } from '@humanbehind/verifier';

const ok = await isHumanBacked(42n, {
  client, // viem PublicClient
  registry: '0xHumanBindingRegistry', // pinned in your config
  maxAgentsPerHuman: 1, // optional stricter policy
});
```

## Relation to the ERC-8004 Validation Registry

The Validation Registry (`validationRequest` / `validationResponse` with a
0 to 100 score and a tag) could carry this signal too: an off-chain validator
watches `HumanBound` / `BindingRevoked` and posts `validationResponse(…, 100,
…, tag = "human-backed")`. We chose a dedicated registry instead because the
validation response would be a validator's _claim_, while `isHumanBacked` is
the proof verification itself, readable by any contract in one call. A
validator bridge is listed as future work.
