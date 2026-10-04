/**
 * @humanbehind/verifier
 *
 * One question for agent marketplaces: "is there a unique, adult human
 * accountable for this ERC-8004 agent?" Answered from chain state only.
 *
 *   const ok = await isHumanBacked(42n, { client, registry: TRUSTED_REGISTRY });
 *
 * Rules this library follows:
 * - Fail closed. RPC errors, unknown chains, test anchors (unless explicitly
 *   allowed) all return false.
 * - Never trust the agent card for the answer. The card's `humanBacking`
 *   entry is a discovery hint; you pass the registry address YOU trust. A card
 *   can point at any contract, including one that always returns true.
 */
import type { Address, PublicClient } from 'viem';

export const humanBindingRegistryReadAbi = [
  {
    type: 'function',
    name: 'attestation',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      {
        name: 'a',
        type: 'tuple',
        components: [
          { name: 'humanBacked', type: 'bool' },
          { name: 'ageAbove18', type: 'bool' },
          { name: 'testAnchor', type: 'bool' },
          { name: 'nullifier', type: 'uint256' },
          { name: 'boundOwner', type: 'address' },
          { name: 'boundAt', type: 'uint64' },
          { name: 'qrTimestamp', type: 'uint64' },
          { name: 'agentsForHuman', type: 'uint256' },
          { name: 'maxAgentsForHuman', type: 'uint256' },
        ],
      },
    ],
  },
  { type: 'function', name: 'identityRegistry', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

export type HumanBacking = {
  agentId: bigint;
  chainId: number;
  registry: Address;
  identityRegistry: Address;
  humanBacked: boolean;
  ageAbove18: boolean;
  /** True when the registry trusts the public anon-aadhaar TEST key. */
  testAnchor: boolean;
  /** Per-app pseudonymous human id. Same for all agents of one human in this registry. */
  nullifier: bigint;
  boundOwner: Address;
  boundAt: Date | null;
  qrTimestamp: Date | null;
  agentsForHuman: bigint;
  maxAgentsForHuman: bigint;
};

/**
 * Raw on-chain attestation for `agentId` from the binding registry you trust.
 * No policy is applied; pass the result to `evaluate` for a verdict. Throws on
 * RPC errors (use `isHumanBacked` for a fail-closed boolean).
 */
export async function getHumanBacking(
  agentId: bigint,
  opts: { client: PublicClient; registry: Address },
): Promise<HumanBacking> {
  const { client, registry } = opts;
  const [a, identityRegistry, chainId] = await Promise.all([
    client.readContract({
      address: registry,
      abi: humanBindingRegistryReadAbi,
      functionName: 'attestation',
      args: [agentId],
    }),
    client.readContract({ address: registry, abi: humanBindingRegistryReadAbi, functionName: 'identityRegistry' }),
    client.getChainId(),
  ]);
  const date = (s: bigint) => (s === 0n ? null : new Date(Number(s) * 1000));
  return {
    agentId,
    chainId,
    registry,
    identityRegistry,
    humanBacked: a.humanBacked,
    ageAbove18: a.ageAbove18,
    testAnchor: a.testAnchor,
    nullifier: a.nullifier,
    boundOwner: a.boundOwner,
    boundAt: date(a.boundAt),
    qrTimestamp: date(a.qrTimestamp),
    agentsForHuman: a.agentsForHuman,
    maxAgentsForHuman: a.maxAgentsForHuman,
  };
}

export type IsHumanBackedOptions = {
  client: PublicClient;
  /** The binding registry you trust. Pin it in config; never take it from a card. */
  registry: Address;
  /**
   * The ERC-8004 identity registry the agentId belongs to. An agentId is only
   * unique within one identity registry, so pass this whenever you know it:
   * the check fails if the binding registry serves a different one.
   */
  identityRegistry?: Address;
  /** Accept bindings made with the public test key. Only for dev/test. Default false. */
  allowTestAnchor?: boolean;
  /** Require the agent be 18+ backed. Default true. */
  requireAdult?: boolean;
  /** Stricter marketplace policy, e.g. 1 = "this human has no other agents here". */
  maxAgentsPerHuman?: number;
  /** Reject bindings older than this many seconds (forces periodic re-proof). */
  maxBindingAgeSec?: number;
  /** Override "now" (tests). */
  now?: Date;
};

/** Returns true only if every check passes. Any error => false (fail closed). */
export async function isHumanBacked(agentId: bigint | number, opts: IsHumanBackedOptions): Promise<boolean> {
  try {
    return evaluate(await getHumanBacking(BigInt(agentId), opts), opts).ok;
  } catch {
    return false;
  }
}

export type Verdict = { ok: boolean; reasons: string[] };

/** Pure policy evaluation, exposed so callers can show *why* a check failed. */
export function evaluate(b: HumanBacking, opts: Omit<IsHumanBackedOptions, 'client' | 'registry'>): Verdict {
  const reasons: string[] = [];
  if (!b.humanBacked) reasons.push('no live binding (never bound, revoked, or agent changed hands)');
  if (opts.identityRegistry && opts.identityRegistry.toLowerCase() !== b.identityRegistry.toLowerCase()) {
    reasons.push(`binding registry serves identity registry ${b.identityRegistry}, not ${opts.identityRegistry}`);
  }
  if (b.testAnchor && !opts.allowTestAnchor)
    reasons.push('registry trusts the public TEST key; not a real-human proof');
  if ((opts.requireAdult ?? true) && !b.ageAbove18) reasons.push('not proven 18+');
  if (opts.maxAgentsPerHuman !== undefined && b.agentsForHuman > BigInt(opts.maxAgentsPerHuman)) {
    reasons.push(`human backs ${b.agentsForHuman} agents, policy allows ${opts.maxAgentsPerHuman}`);
  }
  if (opts.maxBindingAgeSec !== undefined && b.boundAt) {
    const age = ((opts.now ?? new Date()).getTime() - b.boundAt.getTime()) / 1000;
    if (age > opts.maxBindingAgeSec) reasons.push('binding older than policy allows');
  }
  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// ERC-8004 registration file extension
// ---------------------------------------------------------------------------

export const HUMAN_BACKING_TYPE = 'humanbehind/anon-aadhaar-binding-v1' as const;

/** Entry in an ERC-8004 registration file's `humanBacking` array. */
export type HumanBackingEntry = {
  type: typeof HUMAN_BACKING_TYPE;
  /** CAIP-10 style: eip155:<chainId>:<HumanBindingRegistry address> */
  bindingRegistry: string;
  agentId: number | string;
  claims: Array<'unique-human' | 'age-over-18'>;
  trustAnchor: 'uidai-offline-kyc' | 'anon-aadhaar-test';
  check: 'isHumanBacked(uint256)';
};

/** Parse a CAIP-10 account id (`eip155:<chainId>:<address>`). Throws on anything else. */
export function parseCaip10(s: string): { namespace: string; chainId: number; address: Address } {
  const m = /^([a-z0-9-]+):(\d+):(0x[0-9a-fA-F]{40})$/.exec(s);
  if (!m) throw new Error(`not a CAIP-10 account id: ${s}`);
  return { namespace: m[1], chainId: Number(m[2]), address: m[3] as Address };
}

/** Extract humanBacking pointers from a registration file. Hints only. */
export function humanBackingFromCard(card: unknown): HumanBackingEntry[] {
  if (!card || typeof card !== 'object') return [];
  const raw = (card as { humanBacking?: unknown }).humanBacking;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is HumanBackingEntry =>
      !!e &&
      typeof e === 'object' &&
      (e as HumanBackingEntry).type === HUMAN_BACKING_TYPE &&
      typeof (e as HumanBackingEntry).bindingRegistry === 'string',
  );
}

export type VerifyCardClaimOptions = {
  client: PublicClient;
  /** Binding registries you trust, pinned in your config. */
  trustedRegistries: Address[];
  /**
   * The agent you are evaluating, resolved by you (for example the token whose
   * `tokenURI` served this card). Required: without it, a card could point at a
   * trusted registry entry for somebody else's human-backed agent and borrow
   * its badge.
   */
  agentId: bigint | number;
  /** The ERC-8004 identity registry that `agentId` lives in. Required for the same reason. */
  identityRegistry: Address;
} & Omit<IsHumanBackedOptions, 'client' | 'registry' | 'identityRegistry'>;

/**
 * Check a card's claim against chain, but only for the agent you asked about
 * and only against registries you trust. Entries that point anywhere else, or
 * name a different agentId, are ignored. Any error => false (fail closed).
 */
export async function verifyCardClaim(card: unknown, opts: VerifyCardClaimOptions): Promise<boolean> {
  let chainId: number;
  let expectedAgentId: bigint;
  try {
    chainId = await opts.client.getChainId();
    expectedAgentId = BigInt(opts.agentId);
  } catch {
    return false;
  }
  const trusted = new Set(opts.trustedRegistries.map((a) => a.toLowerCase()));
  for (const e of humanBackingFromCard(card)) {
    try {
      const { chainId: c, address } = parseCaip10(e.bindingRegistry);
      if (c !== chainId || !trusted.has(address.toLowerCase())) continue;
      if (BigInt(e.agentId) !== expectedAgentId) continue;
      if (await isHumanBacked(expectedAgentId, { ...opts, registry: address })) return true;
    } catch {
      // A malformed entry is skipped, not trusted; later entries still get a chance.
    }
  }
  return false;
}
