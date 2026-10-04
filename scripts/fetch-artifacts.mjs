// Downloads the anon-aadhaar v2.0.0 circuit artifacts into .artifacts/ (gitignored).
// The zkey is 612 MB. Files already present are skipped.
//   pnpm artifacts
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const BASE = 'https://anon-aadhaar-artifacts.s3.eu-central-1.amazonaws.com/v2.0.0';
const FILES = ['vkey.json', 'aadhaar-verifier.wasm', 'circuit_final.zkey'];
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.artifacts');
mkdirSync(dir, { recursive: true });

for (const f of FILES) {
  const dest = path.join(dir, f);
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`skip ${f} (exists)`);
    continue;
  }
  console.log(`fetch ${BASE}/${f}`);
  const res = await fetch(`${BASE}/${f}`);
  if (!res.ok || !res.body) throw new Error(`download failed for ${f}: HTTP ${res.status}`);
  // Write to a temp name so an interrupted download is never mistaken for a complete file.
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, dest);
  console.log(`  ${(statSync(dest).size / 1e6).toFixed(1)} MB`);
}
