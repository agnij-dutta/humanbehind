import { defineChain, type Address } from 'viem';

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545';

// Defined inline (not imported from viem/chains) to keep the client bundle small.
const NAMES: Record<number, { name: string; symbol: string }> = {
  31337: { name: 'Anvil', symbol: 'ETH' },
  43113: { name: 'Avalanche Fuji', symbol: 'AVAX' },
  11155111: { name: 'Sepolia', symbol: 'ETH' },
};
const meta = NAMES[chainId] ?? { name: `chain ${chainId}`, symbol: 'ETH' };
export const chain = defineChain({
  id: chainId,
  name: meta.name,
  nativeCurrency: { name: meta.symbol, symbol: meta.symbol, decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});

export const config = {
  chainId,
  rpcUrl,
  identityRegistry: (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY ?? '') as Address,
  bindingRegistry: (process.env.NEXT_PUBLIC_BINDING_REGISTRY ?? '') as Address,
  /**
   * Client-side flag ONLY controls UI affordances (showing the TEST QR button,
   * the anvil dev wallet). It never decides what is trusted: the trust anchor
   * is read from the registry contract, and the TEST-QR endpoint checks the
   * server-only HB_DEV_MODE.
   */
  devMode: process.env.NEXT_PUBLIC_DEV_MODE === 'true',
  artifactsBase:
    process.env.NEXT_PUBLIC_ARTIFACTS_BASE ?? 'https://anon-aadhaar-artifacts.s3.eu-central-1.amazonaws.com/v2.0.0',
};

export const isConfigured = () => /^0x[0-9a-fA-F]{40}$/.test(config.bindingRegistry) && /^0x[0-9a-fA-F]{40}$/.test(config.identityRegistry);
