import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Address } from 'viem';
import {
  TEST_PUBKEY_HASH,
  anonAadhaarSignalHash,
  computeBindSignal,
  computeRevokeSignal,
  packGroth16Proof,
  proofFromJson,
  proofToJson,
  type BindingProofJson,
} from '../src/index.js';

// The real-proof fixture was produced against these exact signals, and the
// forge suite verifies those proofs on-chain. Matching it here pins the
// off-chain signal encoding to the contract's.
const fixturePath = fileURLToPath(new URL('../../../contracts/test/fixtures/real-proof.json', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  chainId: string;
  registry: Address;
  identity: Address;
  owner: Address;
  agentId: string;
  bind: BindingProofJson;
  revoke: BindingProofJson;
};

const base = {
  chainId: BigInt(fixture.chainId),
  registry: fixture.registry,
  identityRegistry: fixture.identity,
  agentId: BigInt(fixture.agentId),
};

test('computeBindSignal matches the signal the on-chain verified fixture proves', () => {
  assert.equal(computeBindSignal({ ...base, owner: fixture.owner, nonce: 0n }), BigInt(fixture.bind.signal));
});

test('computeRevokeSignal at nonce 1 matches the fixture revoke proof', () => {
  assert.equal(computeRevokeSignal({ ...base, nonce: 1n }), BigInt(fixture.revoke.signal));
});

test('bind signal changes with every bound field (no replay across agent, chain, registry, owner, nonce)', () => {
  const ref = computeBindSignal({ ...base, owner: fixture.owner, nonce: 0n });
  const other: Address = '0x0000000000000000000000000000000000000bad';
  const variants = [
    computeBindSignal({ ...base, owner: fixture.owner, nonce: 1n }),
    computeBindSignal({ ...base, agentId: 2n, owner: fixture.owner, nonce: 0n }),
    computeBindSignal({ ...base, chainId: 1n, owner: fixture.owner, nonce: 0n }),
    computeBindSignal({ ...base, registry: other, owner: fixture.owner, nonce: 0n }),
    computeBindSignal({ ...base, identityRegistry: other, owner: fixture.owner, nonce: 0n }),
    computeBindSignal({ ...base, owner: other, nonce: 0n }),
  ];
  for (const v of variants) assert.notEqual(v, ref);
});

test('bind and revoke signals use different domains', () => {
  assert.notEqual(
    computeBindSignal({ ...base, owner: fixture.owner, nonce: 1n }),
    computeRevokeSignal({ ...base, nonce: 1n }),
  );
});

test('anonAadhaarSignalHash fits the SNARK field (253 bits)', () => {
  const h = anonAadhaarSignalHash(2n ** 256n - 1n);
  assert.ok(h < 2n ** 253n);
});

test('fixture proofs were made under the public test anchor', () => {
  assert.equal(BigInt(fixture.bind.pubkeyHash), TEST_PUBKEY_HASH);
});

test('packGroth16Proof swaps the G2 coordinates the way the Solidity verifier expects', () => {
  const packed = packGroth16Proof({
    pi_a: ['1', '2', '1'],
    pi_b: [
      ['3', '4'],
      ['5', '6'],
      ['1', '0'],
    ],
    pi_c: ['7', '8', '1'],
  });
  assert.deepEqual(packed, [1n, 2n, 4n, 3n, 6n, 5n, 7n, 8n]);
});

test('proofToJson / proofFromJson round-trip', () => {
  const p = proofFromJson(fixture.bind);
  assert.deepEqual(proofFromJson(proofToJson(p)), p);
});

test('proofFromJson rejects a packed proof of the wrong length', () => {
  assert.throws(() => proofFromJson({ ...fixture.bind, packed: fixture.bind.packed.slice(0, 7) }), /8 elements/);
});
