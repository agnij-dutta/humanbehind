// @anon-aadhaar/core@2.4.3 publishes `"types": "./src/index.ts"`, so tsc would
// typecheck its raw sources under our strict settings (and fail). These are
// the declarations for the small surface we use; tsconfig `paths` points the
// module name here for type purposes only. Runtime still loads its dist.
type Arg<T> = { argumentType: string; value?: T };
export type AnonAadhaarArgs = {
  qrDataPadded: Arg<string[]>;
  qrDataPaddedLength: Arg<string>;
  delimiterIndices: Arg<string[]>;
  signature: Arg<string[]>;
  pubKey: Arg<string[]>;
  nullifierSeed: Arg<string>;
  signalHash: Arg<string>;
  revealAgeAbove18: Arg<string>;
  revealGender: Arg<string>;
  revealPinCode: Arg<string>;
  revealState: Arg<string>;
};
export type FieldsToReveal = 'revealAgeAbove18' | 'revealGender' | 'revealPinCode' | 'revealState';
export function generateArgs(o: {
  qrData: string;
  certificateFile: string;
  nullifierSeed: number | bigint;
  fieldsToRevealArray?: FieldsToReveal[];
  signal?: string;
}): Promise<AnonAadhaarArgs>;
export function convertBigIntToByteArray(n: bigint): Uint8Array;
export function decompressByteArray(b: Uint8Array): Uint8Array;
export function rawDataToCompressedQR(data: Uint8Array): bigint;
export function createCustomV2TestData(o: {
  signedData: Uint8Array;
  dob?: string;
  pincode?: string;
  gender?: string;
  state?: string;
  photo?: boolean;
}): Uint8Array;
export function hash(message: string | number | bigint): string;
