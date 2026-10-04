import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Address, PublicClient } from 'viem';
import {
  HUMAN_BACKING_TYPE,
  evaluate,
  humanBackingFromCard,
  isHumanBacked,
  parseCaip10,
  verifyCardClaim,
  type HumanBacking,
} from '../src/index.js';

const REGISTRY: Address = '0x00000000000000000000000000000000000b1d00';
const IDENTITY: Address = '0x0000000000000000000000000000000000001d00';
const OWNER: Address = '0x00000000000000000000000000000000000a11ce';
const CHAIN_ID = 31337;

type Attestation = {
  humanBacked: boolean;
  ageAbove18: boolean;
  testAnchor: boolean;
  nullifier: bigint;
  boundOwner: Address;
  boundAt: bigint;
  qrTimestamp: bigint;
  agentsForHuman: bigint;
  maxAgentsForHuman: bigint;
};

const live = (over: Partial<Attestation> = {}): Attestation => ({
  humanBacked: true,
  ageAbove18: true,
  testAnchor: false,
  nullifier: 42n,
  boundOwner: OWNER,
  boundAt: 1_700_000_000n,
  qrTimestamp: 1_699_999_000n,
  agentsForHuman: 1n,
  maxAgentsForHuman: 3n,
  ...over,
});

const unbound: Attestation = {
  humanBacked: false,
  ageAbove18: false,
  testAnchor: false,
  nullifier: 0n,
  boundOwner: '0x0000000000000000000000000000000000000000',
  boundAt: 0n,
  qrTimestamp: 0n,
  agentsForHuman: 0n,
  maxAgentsForHuman: 3n,
};

/** A fake viem client serving attestations per (registry, agentId). */
function fakeClient(table: Record<string, Attestation>, chainId = CHAIN_ID): PublicClient {
  return {
    getChainId: async () => chainId,
    readContract: async ({
      address,
      functionName,
      args,
    }: {
      address: Address;
      functionName: string;
      args?: [bigint];
    }) => {
      if (functionName === 'identityRegistry') return IDENTITY;
      const key = `${address.toLowerCase()}:${args![0]}`;
      return table[key] ?? unbound;
    },
  } as unknown as PublicClient;
}

const backing = (over: Partial<HumanBacking> = {}): HumanBacking => ({
  agentId: 1n,
  chainId: CHAIN_ID,
  registry: REGISTRY,
  identityRegistry: IDENTITY,
  humanBacked: true,
  ageAbove18: true,
  testAnchor: false,
  nullifier: 42n,
  boundOwner: OWNER,
  boundAt: new Date(1_700_000_000_000),
  qrTimestamp: new Date(1_699_999_000_000),
  agentsForHuman: 1n,
  maxAgentsForHuman: 3n,
  ...over,
});

test('evaluate: a live, adult, production-anchor binding passes', () => {
  assert.deepEqual(evaluate(backing(), {}), { ok: true, reasons: [] });
});

test('evaluate: test anchor fails unless explicitly allowed', () => {
  assert.equal(evaluate(backing({ testAnchor: true }), {}).ok, false);
  assert.equal(evaluate(backing({ testAnchor: true }), { allowTestAnchor: true }).ok, true);
});

test('evaluate: unbound, minor, over-cap and stale bindings fail', () => {
  assert.equal(evaluate(backing({ humanBacked: false }), {}).ok, false);
  assert.equal(evaluate(backing({ ageAbove18: false }), {}).ok, false);
  assert.equal(evaluate(backing({ agentsForHuman: 2n }), { maxAgentsPerHuman: 1 }).ok, false);
  const now = new Date(1_700_000_000_000 + 3_600_000);
  assert.equal(evaluate(backing(), { maxBindingAgeSec: 60, now }).ok, false);
  assert.equal(evaluate(backing(), { maxBindingAgeSec: 7200, now }).ok, true);
});

test('isHumanBacked reads chain state and fails closed on RPC errors', async () => {
  const client = fakeClient({ [`${REGISTRY.toLowerCase()}:1`]: live() });
  assert.equal(await isHumanBacked(1n, { client, registry: REGISTRY }), true);
  assert.equal(await isHumanBacked(2n, { client, registry: REGISTRY }), false);

  const broken = {
    getChainId: async () => CHAIN_ID,
    readContract: async () => {
      throw new Error('rpc down');
    },
  } as unknown as PublicClient;
  assert.equal(await isHumanBacked(1n, { client: broken, registry: REGISTRY }), false);
});

test('parseCaip10 accepts eip155 account ids and rejects junk', () => {
  assert.deepEqual(parseCaip10(`eip155:${CHAIN_ID}:${REGISTRY}`), {
    namespace: 'eip155',
    chainId: CHAIN_ID,
    address: REGISTRY,
  });
  assert.throws(() => parseCaip10('eip155:1:0x1234'));
  assert.throws(() => parseCaip10(REGISTRY));
});

test('humanBackingFromCard ignores malformed entries', () => {
  assert.deepEqual(humanBackingFromCard(null), []);
  assert.deepEqual(humanBackingFromCard({ humanBacking: 'yes' }), []);
  assert.equal(
    humanBackingFromCard({ humanBacking: [{ type: 'other' }, { type: HUMAN_BACKING_TYPE, bindingRegistry: 'x' }] })
      .length,
    1,
  );
});

const card = (agentId: number, registry: Address = REGISTRY, chainId = CHAIN_ID) => ({
  humanBacking: [
    {
      type: HUMAN_BACKING_TYPE,
      bindingRegistry: `eip155:${chainId}:${registry}`,
      agentId,
      claims: ['unique-human', 'age-over-18'],
      trustAnchor: 'uidai-offline-kyc',
      check: 'isHumanBacked(uint256)',
    },
  ],
});

test('verifyCardClaim: accepts a true claim against a trusted registry', async () => {
  const client = fakeClient({ [`${REGISTRY.toLowerCase()}:1`]: live() });
  assert.equal(
    await verifyCardClaim(card(1), { client, agentId: 1n, identityRegistry: IDENTITY, trustedRegistries: [REGISTRY] }),
    true,
  );
});

test('verifyCardClaim: rejects registries that are not trusted or on another chain', async () => {
  const evil: Address = '0x000000000000000000000000000000000000e111';
  const client = fakeClient({ [`${evil}:1`]: live(), [`${REGISTRY.toLowerCase()}:1`]: live() });
  assert.equal(
    await verifyCardClaim(card(1, evil), {
      client,
      agentId: 1n,
      identityRegistry: IDENTITY,
      trustedRegistries: [REGISTRY],
    }),
    false,
  );
  assert.equal(
    await verifyCardClaim(card(1, REGISTRY, 1), {
      client,
      agentId: 1n,
      identityRegistry: IDENTITY,
      trustedRegistries: [REGISTRY],
    }),
    false,
  );
});

test("verifyCardClaim: a card cannot borrow another agent's binding", async () => {
  // Agent 1 is genuinely human-backed. Agent 7's card claims agentId 1 on the
  // trusted registry. Asking about agent 7 must not return true.
  const client = fakeClient({ [`${REGISTRY.toLowerCase()}:1`]: live() });
  assert.equal(
    await verifyCardClaim(card(1), { client, agentId: 7n, identityRegistry: IDENTITY, trustedRegistries: [REGISTRY] }),
    false,
  );
});

test('verifyCardClaim: rejects a registry serving a different identity registry', async () => {
  const client = fakeClient({ [`${REGISTRY.toLowerCase()}:1`]: live() });
  const otherIdentity: Address = '0x0000000000000000000000000000000000002d00';
  assert.equal(
    await verifyCardClaim(card(1), {
      client,
      agentId: 1n,
      identityRegistry: otherIdentity,
      trustedRegistries: [REGISTRY],
    }),
    false,
  );
});

test('verifyCardClaim: a malformed entry does not hide a later valid one', async () => {
  const client = fakeClient({ [`${REGISTRY.toLowerCase()}:1`]: live() });
  const good = card(1).humanBacking[0];
  const withJunk = { humanBacking: [{ ...good, bindingRegistry: 'eip155:x:nope' }, { ...good, agentId: 'abc' }, good] };
  assert.equal(
    await verifyCardClaim(withJunk, { client, agentId: 1n, identityRegistry: IDENTITY, trustedRegistries: [REGISTRY] }),
    true,
  );
});

test('isHumanBacked: identityRegistry mismatch fails closed', async () => {
  const client = fakeClient({ [`${REGISTRY.toLowerCase()}:1`]: live() });
  assert.equal(await isHumanBacked(1n, { client, registry: REGISTRY, identityRegistry: IDENTITY }), true);
  assert.equal(
    await isHumanBacked(1n, {
      client,
      registry: REGISTRY,
      identityRegistry: '0x0000000000000000000000000000000000002d00',
    }),
    false,
  );
});
