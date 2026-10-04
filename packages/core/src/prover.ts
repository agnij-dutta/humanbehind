// Proving: turns a Secure Aadhaar QR payload into a BindingProof whose public
// outputs match HumanBindingRegistry's hardcoded disclosure policy
// (ageAbove18 revealed, gender/pincode/state hidden).
//
// Runs in the browser and in Node. We call snarkjs directly instead of
// @anon-aadhaar/core's prove() so we can pass `singleThread: true`: in zkdir,
// browser proving only completed reliably in single-thread mode, and that
// required patching core's dist. Owning the fullProve call avoids the patch.
import { generateArgs } from '@anon-aadhaar/core';
import * as snarkjs from 'snarkjs';
import { anonAadhaarSignalHash, packGroth16Proof, type BindingProof, type Groth16Proof } from './index.js';

export type ProverStage = 'parsing-qr' | 'loading-artifacts' | 'proving' | 'done';

export type ProveOptions = {
  /** Decimal string of the Secure QR's big integer (what QR scanners return). */
  qrData: string;
  /** PEM certificate whose key signed the QR. Test cert in dev, UIDAI cert in prod. */
  certificatePem: string;
  /** Read from the registry: `nullifierSeed()`. Never chosen by the user. */
  nullifierSeed: bigint;
  /** Read from the registry: `bindSignal(agentId, owner)` or `revokeSignal(agentId)`. */
  signal: bigint;
  /** Circuit wasm and zkey: URL/path string or bytes. */
  wasm: string | Uint8Array;
  zkey: string | Uint8Array;
  singleThread?: boolean;
  onStage?: (s: ProverStage) => void;
};

export class PolicyError extends Error {}

export async function proveBinding(o: ProveOptions): Promise<BindingProof> {
  o.onStage?.('parsing-qr');
  const args = await generateArgs({
    qrData: o.qrData,
    certificateFile: o.certificatePem,
    nullifierSeed: o.nullifierSeed,
    signal: o.signal.toString(),
    fieldsToRevealArray: ['revealAgeAbove18'],
  });

  // Our signal hash must equal the one the contract recomputes on-chain.
  const expectedSignalHash = anonAadhaarSignalHash(o.signal);
  if (BigInt(args.signalHash.value!) !== expectedSignalHash) {
    throw new Error('signal hash mismatch between anon-aadhaar and on-chain hashing');
  }

  const input = {
    qrDataPadded: args.qrDataPadded.value!,
    qrDataPaddedLength: args.qrDataPaddedLength.value!,
    delimiterIndices: args.delimiterIndices.value!,
    signature: args.signature.value!,
    pubKey: args.pubKey.value!,
    nullifierSeed: args.nullifierSeed.value!,
    signalHash: args.signalHash.value!,
    revealAgeAbove18: args.revealAgeAbove18.value!,
    revealGender: args.revealGender.value!,
    revealPinCode: args.revealPinCode.value!,
    revealState: args.revealState.value!,
  };

  o.onStage?.('proving');
  const t0 = performance.now();
  // snarkjs >= 0.7.4: fullProve(input, wasm, zkey, logger, wtnsCalcOptions, proverOptions)
  const fullProve = snarkjs.groth16.fullProve as unknown as (
    input: unknown,
    wasm: unknown,
    zkey: unknown,
    logger?: unknown,
    wtnsCalcOptions?: unknown,
    proverOptions?: { singleThread?: boolean },
  ) => Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
  const { proof, publicSignals } = await fullProve(input, o.wasm, o.zkey, undefined, undefined, {
    singleThread: o.singleThread ?? true,
  });
  const provingMs = Math.round(performance.now() - t0);

  // publicSignals: [pubkeyHash, nullifier, timestamp, ageAbove18, gender, pincode, state, nullifierSeed, signalHash]
  const [pubkeyHash, nullifier, timestamp, ageAbove18, gender, pincode, state] = publicSignals.map((x) => BigInt(x));
  if (ageAbove18 !== 1n) throw new PolicyError('This identity is not 18+; the registry will reject it.');
  if (gender !== 0n || pincode !== 0n || state !== 0n) {
    throw new PolicyError('Proof reveals more than ageAbove18; refusing to submit.');
  }

  o.onStage?.('done');
  return {
    nullifier,
    timestamp,
    pubkeyHash,
    ageAbove18,
    signal: o.signal,
    nullifierSeed: o.nullifierSeed,
    packed: packGroth16Proof(proof),
    provingMs,
  };
}

/** Off-chain groth16 check against a vkey. Useful before paying gas. */
export async function verifyBindingProofOffchain(vkey: object, p: BindingProof, groth16: Groth16Proof): Promise<boolean> {
  return snarkjs.groth16.verify(
    vkey as never,
    [p.pubkeyHash, p.nullifier, p.timestamp, p.ageAbove18, 0n, 0n, 0n, p.nullifierSeed, anonAadhaarSignalHash(p.signal)].map(String),
    groth16 as never,
  );
}
