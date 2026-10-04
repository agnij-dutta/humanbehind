declare module 'snarkjs' {
  export const groth16: {
    fullProve(
      input: unknown,
      wasm: unknown,
      zkey: unknown,
      logger?: unknown,
    ): Promise<{ proof: unknown; publicSignals: string[] }>;
    verify(vkey: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
  };
}
