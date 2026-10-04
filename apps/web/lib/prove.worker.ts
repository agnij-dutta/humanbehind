/// <reference lib="webworker" />
// Runs the groth16 prover off the main thread. singleThread: true because a
// worker can't reliably spawn nested workers, and in zkdir multi-threaded
// browser proving hung while single-thread completed (~89s on a laptop).
import { proveBinding, type ProverStage } from '@humanbehind/core/prover';
import { proofToJson } from '@humanbehind/core';

export type ProveRequest = {
  qrData: string;
  certificatePem: string;
  nullifierSeed: string;
  signal: string;
  wasmUrl: string;
  zkeyUrl: string;
};
export type ProveMessage =
  | { kind: 'stage'; stage: ProverStage }
  | { kind: 'done'; proof: ReturnType<typeof proofToJson> }
  | { kind: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (ev: MessageEvent<ProveRequest>) => {
  const r = ev.data;
  try {
    const proof = await proveBinding({
      qrData: r.qrData,
      certificatePem: r.certificatePem,
      nullifierSeed: BigInt(r.nullifierSeed),
      signal: BigInt(r.signal),
      wasm: r.wasmUrl,
      zkey: r.zkeyUrl,
      singleThread: true,
      onStage: (stage) => ctx.postMessage({ kind: 'stage', stage } satisfies ProveMessage),
    });
    ctx.postMessage({ kind: 'done', proof: proofToJson(proof) } satisfies ProveMessage);
  } catch (e) {
    ctx.postMessage({ kind: 'error', message: e instanceof Error ? e.message : String(e) } satisfies ProveMessage);
  }
};
