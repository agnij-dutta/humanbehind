import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, toHex } from 'viem';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ART = path.join(ROOT, '.artifacts');
export const WASM = path.join(ART, 'aadhaar-verifier.wasm');
export const ZKEY = path.join(ART, 'circuit_final.zkey');
export const VKEY = path.join(ART, 'vkey.json');

export const devFixture = (f: string) => readFileSync(path.join(ROOT, 'dev-fixtures', f), 'utf8');

/** This app's nullifier seed. Fixed per deployment; a human gets one nullifier per seed. */
export const NULLIFIER_SEED = BigInt(keccak256(toHex('humanbehind.nullifierSeed.v1'))) >> 3n;
