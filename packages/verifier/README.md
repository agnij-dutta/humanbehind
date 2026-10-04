# @humanbehind/verifier

Answer one question for an agent marketplace: is a unique, adult human
accountable for this ERC-8004 agent? Reads `HumanBindingRegistry` state with
viem. No proving, no personal data.

```ts
import { isHumanBacked } from '@humanbehind/verifier';

const ok = await isHumanBacked(42n, {
  client, // viem PublicClient
  registry: '0x...', // the HumanBindingRegistry YOU trust, pinned in config
  identityRegistry: '0x...', // the ERC-8004 registry agent 42 lives in
});
```

Fails closed: RPC errors, test-anchored registries (unless `allowTestAnchor`)
and identity registry mismatches all return `false`.

| Export                           | Purpose                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `isHumanBacked(agentId, opts)`   | Boolean verdict, fail closed.                                                            |
| `getHumanBacking(agentId, opts)` | Raw attestation (nullifier, owner, timestamps, agents for this human). Throws on errors. |
| `evaluate(backing, policy)`      | Pure policy check returning `{ ok, reasons }`.                                           |
| `verifyCardClaim(card, opts)`    | Check a registration file's `humanBacking` entries for the agent you resolved.           |
| `humanBackingFromCard(card)`     | Extract well-formed `humanBacking` entries (hints only).                                 |
| `parseCaip10(id)`                | Parse `eip155:<chainId>:<address>`.                                                      |

Policy options (`IsHumanBackedOptions`):

| Option              | Default      | Meaning                                                         |
| ------------------- | ------------ | --------------------------------------------------------------- |
| `registry`          | none         | Binding registry to read. Required. Never take it from a card.  |
| `identityRegistry`  | unset        | Fail unless the binding registry serves this ERC-8004 registry. |
| `allowTestAnchor`   | `false`      | Accept registries anchored to the public anon-aadhaar test key. |
| `requireAdult`      | `true`       | Require the 18+ claim.                                          |
| `maxAgentsPerHuman` | unset        | Stricter cap than the registry's, e.g. `1`.                     |
| `maxBindingAgeSec`  | unset        | Reject bindings older than this, forcing periodic re-proof.     |
| `now`               | `new Date()` | Clock override for tests.                                       |

See the [project README](../../README.md) for the security model. MIT.
