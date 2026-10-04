import { encodeAbiParameters, keccak256, toHex, type Address } from 'viem';

export * from './abi.js';

/** anon-aadhaar public TEST key hash. Proofs under it say nothing about a real person. */
export const TEST_PUBKEY_HASH =
  15134874015316324267425466444584014077184337590635665158241104437045239495873n;
/** UIDAI production offline-KYC key hash (uidai_offline_publickey_26022021.cer). */
export const PRODUCTION_PUBKEY_HASH =
  18063425702624337643644061197836918910810808173893535653269228433734128853484n;

export const BIND_DOMAIN = keccak256(toHex('humanbehind.bind.v1'));
export const REVOKE_DOMAIN = keccak256(toHex('humanbehind.revoke.v1'));

export type Groth16Proof = {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
};

/** Packed for Solidity: matches anon-aadhaar's `packGroth16Proof`. */
export type PackedProof = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

export function packGroth16Proof(p: Groth16Proof): PackedProof {
  return [
    BigInt(p.pi_a[0]),
    BigInt(p.pi_a[1]),
    BigInt(p.pi_b[0][1]),
    BigInt(p.pi_b[0][0]),
    BigInt(p.pi_b[1][1]),
    BigInt(p.pi_b[1][0]),
    BigInt(p.pi_c[0]),
    BigInt(p.pi_c[1]),
  ] as const;
}

/**
 * Mirrors HumanBindingRegistry.bindSignal. Clients should prefer reading the
 * signal from the contract (it knows the live nonce); this exists so tests and
 * offline tooling can cross-check.
 */
export function computeBindSignal(args: {
  chainId: bigint | number;
  registry: Address;
  identityRegistry: Address;
  agentId: bigint;
  owner: Address;
  nonce: bigint;
}): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'address' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'uint256' },
        ],
        [BIND_DOMAIN, BigInt(args.chainId), args.registry, args.identityRegistry, args.agentId, args.owner, args.nonce],
      ),
    ),
  );
}

export function computeRevokeSignal(args: {
  chainId: bigint | number;
  registry: Address;
  identityRegistry: Address;
  agentId: bigint;
  nonce: bigint;
}): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
        [REVOKE_DOMAIN, BigInt(args.chainId), args.registry, args.identityRegistry, args.agentId, args.nonce],
      ),
    ),
  );
}

/** anon-aadhaar's signal hash: keccak256(uint256 signal) >> 3 (fits the SNARK field). */
export function anonAadhaarSignalHash(signal: bigint): bigint {
  return BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }], [signal]))) >> 3n;
}

/** The result of proving, in the exact shape `bind` / `revokeByHuman` take. */
export type BindingProof = {
  nullifier: bigint;
  timestamp: bigint;
  pubkeyHash: bigint;
  ageAbove18: bigint;
  signal: bigint;
  nullifierSeed: bigint;
  packed: PackedProof;
  provingMs: number;
};

/** JSON-safe form for transport (bigints as decimal strings). */
export type BindingProofJson = { [K in keyof BindingProof]: K extends 'packed' ? string[] : K extends 'provingMs' ? number : string };

export function proofToJson(p: BindingProof): BindingProofJson {
  return {
    nullifier: p.nullifier.toString(),
    timestamp: p.timestamp.toString(),
    pubkeyHash: p.pubkeyHash.toString(),
    ageAbove18: p.ageAbove18.toString(),
    signal: p.signal.toString(),
    nullifierSeed: p.nullifierSeed.toString(),
    packed: p.packed.map((x) => x.toString()),
    provingMs: p.provingMs,
  };
}

export function proofFromJson(j: BindingProofJson): BindingProof {
  const packed = j.packed.map((x) => BigInt(x));
  if (packed.length !== 8) throw new Error('packed proof must have 8 elements');
  return {
    nullifier: BigInt(j.nullifier),
    timestamp: BigInt(j.timestamp),
    pubkeyHash: BigInt(j.pubkeyHash),
    ageAbove18: BigInt(j.ageAbove18),
    signal: BigInt(j.signal),
    nullifierSeed: BigInt(j.nullifierSeed),
    packed: packed as unknown as PackedProof,
    provingMs: j.provingMs,
  };
}
