// Generates REAL anon-aadhaar groth16 proofs (test key, fictitious UIDAI sample
// resident) for fixed addresses, and writes contracts/test/fixtures/real-proof.json
// for RealProof.t.sol. Also records proving times.
//
//   pnpm fixture            # single-thread (browser-equivalent) + multi-thread timing
//   pnpm fixture --fast     # single proving run only
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { computeBindSignal, computeRevokeSignal, proofToJson } from '@humanbehind/core';
import { proveBinding } from '@humanbehind/core/prover';
import { mintTestQr } from '@humanbehind/core/testqr';
import { ROOT, WASM, ZKEY, devFixture, NULLIFIER_SEED } from './common.js';

// Must match RealProof.t.sol.
const CHAIN_ID = 31337n;
const REGISTRY = '0x00000000000000000000000000000000000b1d00' as const;
const IDENTITY = '0x0000000000000000000000000000000000001d00' as const;
const OWNER = '0x00000000000000000000000000000000000a11ce' as const;
const AGENT_ID = 1n;

const fast = process.argv.includes('--fast');

async function main() {
  const qrData = mintTestQr({
    sampleQr: devFixture('uidai-sample-v1-qr.txt'),
    testPrivateKeyPem: devFixture('testPrivateKey.pem'),
  });
  const certificatePem = devFixture('testCertificate.pem');

  const bindSignal = computeBindSignal({
    chainId: CHAIN_ID,
    registry: REGISTRY,
    identityRegistry: IDENTITY,
    agentId: AGENT_ID,
    owner: OWNER,
    nonce: 0n,
  });
  // After a successful bind the nonce is 1.
  const revokeSignal = computeRevokeSignal({
    chainId: CHAIN_ID,
    registry: REGISTRY,
    identityRegistry: IDENTITY,
    agentId: AGENT_ID,
    nonce: 1n,
  });

  console.log(`machine: ${os.cpus()[0]?.model} x${os.cpus().length}, node ${process.version}`);
  console.log('proving bind (singleThread)...');
  const bind = await proveBinding({
    qrData,
    certificatePem,
    nullifierSeed: NULLIFIER_SEED,
    signal: bindSignal,
    wasm: WASM,
    zkey: ZKEY,
    singleThread: true,
  });
  console.log(`  bind proof: ${bind.provingMs} ms single-thread`);

  console.log('proving revoke (multi-thread)...');
  const revoke = await proveBinding({
    qrData,
    certificatePem,
    nullifierSeed: NULLIFIER_SEED,
    signal: revokeSignal,
    wasm: WASM,
    zkey: ZKEY,
    singleThread: false,
  });
  console.log(`  revoke proof: ${revoke.provingMs} ms multi-thread`);
  if (revoke.nullifier !== bind.nullifier) throw new Error('same QR + same seed must give the same nullifier');

  let otherHuman;
  if (!fast) {
    console.log('proving bind for a second test human (fresh photo => new nullifier)...');
    const qr2 = mintTestQr({
      sampleQr: devFixture('uidai-sample-v1-qr.txt'),
      testPrivateKeyPem: devFixture('testPrivateKey.pem'),
      freshPhoto: true,
    });
    otherHuman = await proveBinding({
      qrData: qr2,
      certificatePem,
      nullifierSeed: NULLIFIER_SEED,
      signal: bindSignal,
      wasm: WASM,
      zkey: ZKEY,
      singleThread: false,
    });
    console.log(
      `  second human: ${otherHuman.provingMs} ms multi-thread, nullifier differs: ${otherHuman.nullifier !== bind.nullifier}`,
    );
  }

  const dir = path.join(ROOT, 'contracts/test/fixtures');
  mkdirSync(dir, { recursive: true });
  const fixture = {
    note: 'TEST anchor only. Fictitious UIDAI sample resident re-signed with the public anon-aadhaar test key.',
    chainId: CHAIN_ID.toString(),
    registry: REGISTRY,
    identity: IDENTITY,
    owner: OWNER,
    agentId: AGENT_ID.toString(),
    nullifierSeed: NULLIFIER_SEED.toString(),
    bind: proofToJson(bind),
    revoke: proofToJson(revoke),
    otherHuman: otherHuman ? proofToJson(otherHuman) : null,
    machine: `${os.cpus()[0]?.model} x${os.cpus().length}`,
  };
  writeFileSync(path.join(dir, 'real-proof.json'), JSON.stringify(fixture, null, 2));
  console.log('wrote contracts/test/fixtures/real-proof.json');
  process.exit(0); // snarkjs worker threads can keep the loop alive
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
