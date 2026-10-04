// Confirms an under-18 TEST identity cannot produce a submittable proof.
import { proveBinding, PolicyError } from '@humanbehind/core/prover';
import { mintTestQr } from '@humanbehind/core/testqr';
import { WASM, ZKEY, devFixture, NULLIFIER_SEED } from './common.js';

const qrData = mintTestQr({
  sampleQr: devFixture('uidai-sample-v1-qr.txt'),
  testPrivateKeyPem: devFixture('testPrivateKey.pem'),
  dob: '01-01-2015',
});
try {
  await proveBinding({
    qrData,
    certificatePem: devFixture('testCertificate.pem'),
    nullifierSeed: NULLIFIER_SEED,
    signal: 1n,
    wasm: WASM,
    zkey: ZKEY,
    singleThread: false,
  });
  console.log('UNEXPECTED: minor produced an 18+ proof');
  process.exit(1);
} catch (e) {
  console.log(e instanceof PolicyError ? `ok: ${e.message}` : `other error: ${e}`);
  process.exit(e instanceof PolicyError ? 0 : 1);
}
