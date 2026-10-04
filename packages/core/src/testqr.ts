// TEST-ONLY Secure QR minting (Node only).
//
// Takes UIDAI's published sample QR (a fictitious resident), turns it into the
// V2 format with a fresh timestamp, and re-signs it with anon-aadhaar's PUBLIC
// test key. With `freshPhoto: true` the photo bytes are randomized, which yields
// a different nullifier: a different "test human". None of this touches real
// Aadhaar data, and proofs made from it only verify against the test anchor.
import { createSign } from 'node:crypto';
import {
  convertBigIntToByteArray,
  createCustomV2TestData,
  decompressByteArray,
  rawDataToCompressedQR,
} from '@anon-aadhaar/core';

export type TestQrOptions = {
  sampleQr: string;
  testPrivateKeyPem: string;
  freshPhoto?: boolean;
  /** Override DOB (dd-mm-yyyy) e.g. to mint an under-18 test identity. */
  dob?: string;
};

export function mintTestQr(o: TestQrOptions): string {
  const decoded = decompressByteArray(convertBigIntToByteArray(BigInt(o.sampleQr.trim())));
  const toSign = createCustomV2TestData({
    signedData: decoded.slice(0, decoded.length - 256),
    photo: o.freshPhoto ?? false,
    dob: o.dob,
  });
  const signer = createSign('sha256');
  signer.update(Buffer.from(toSign));
  signer.end();
  const signature = signer.sign({ key: o.testPrivateKeyPem });
  const compressed = rawDataToCompressedQR(Buffer.concat([Buffer.from(toSign), signature]));
  return compressed.toString();
}
