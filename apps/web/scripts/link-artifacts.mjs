// Hard-links the circuit artifacts from <repo>/.artifacts into public/artifacts
// so local dev proves without pulling 600MB from S3 every time. Zero extra disk.
import { linkSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
const src = path.resolve('../../.artifacts');
const dst = path.resolve('public/artifacts');
mkdirSync(dst, { recursive: true });
for (const f of ['aadhaar-verifier.wasm', 'circuit_final.zkey', 'vkey.json']) {
  const from = path.join(src, f);
  if (!existsSync(from)) {
    console.error(`missing ${from}; download it first (see README)`);
    process.exit(1);
  }
  const to = path.join(dst, f);
  if (existsSync(to)) rmSync(to);
  linkSync(from, to);
  console.log(`linked ${f}`);
}
