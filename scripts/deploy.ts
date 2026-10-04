// Deploys the full stack to a local chain (anvil) with the TEST anchor.
//   pnpm tsx scripts/deploy.ts            # expects anvil on :8545, writes deployments/local.json + apps/web/.env.local
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, http, type Address, type Hex, type Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { humanBindingRegistryAbi, agentIdentityRegistryAbi, TEST_PUBKEY_HASH } from '@humanbehind/core';
import { ROOT, NULLIFIER_SEED } from './common.js';

/** anvil's default account #0. A publicly known dev key: local chain only. */
export const ANVIL_KEY_0: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

export type Deployment = {
  chainId: number;
  rpcUrl: string;
  anonAadhaar: Address;
  groth16Verifier: Address;
  identityRegistry: Address;
  bindingRegistry: Address;
  nullifierSeed: string;
  testAnchor: true;
};

export async function deployLocal(rpcUrl = 'http://127.0.0.1:8545', maxAgentsPerHuman = 3n): Promise<Deployment> {
  const art = JSON.parse(readFileSync(path.join(ROOT, 'scripts/artifacts.json'), 'utf8'));
  const account = privateKeyToAccount(ANVIL_KEY_0);
  const pub = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain: foundry, transport: http(rpcUrl) });

  async function deploy(abi: Abi, bytecode: Hex, args: unknown[] = []): Promise<Address> {
    const hash = await wallet.deployContract({ abi, bytecode, args } as never);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (!r.contractAddress) throw new Error('deploy failed');
    return r.contractAddress;
  }

  const groth16Verifier = await deploy(art.abis.AnonAadhaarGroth16Verifier, art.bytecode.AnonAadhaarGroth16Verifier);
  const anonAadhaar = await deploy(art.abis.AnonAadhaar, art.bytecode.AnonAadhaar, [groth16Verifier, TEST_PUBKEY_HASH]);
  const identityRegistry = await deploy(agentIdentityRegistryAbi as Abi, art.bytecode.AgentIdentityRegistry);
  const bindingRegistry = await deploy(humanBindingRegistryAbi as Abi, art.bytecode.HumanBindingRegistry, [
    anonAadhaar, identityRegistry, NULLIFIER_SEED, true, maxAgentsPerHuman, 86400n,
  ]);
  return {
    chainId: foundry.id, rpcUrl, anonAadhaar, groth16Verifier, identityRegistry, bindingRegistry,
    nullifierSeed: NULLIFIER_SEED.toString(), testAnchor: true,
  };
}

export function writeDeployment(d: Deployment) {
  mkdirSync(path.join(ROOT, 'deployments'), { recursive: true });
  writeFileSync(path.join(ROOT, 'deployments/local.json'), JSON.stringify(d, null, 2));
  const env = [
    '# Written by scripts/deploy.ts (local anvil, TEST anchor).',
    `NEXT_PUBLIC_CHAIN_ID=${d.chainId}`,
    `NEXT_PUBLIC_RPC_URL=${d.rpcUrl}`,
    `NEXT_PUBLIC_IDENTITY_REGISTRY=${d.identityRegistry}`,
    `NEXT_PUBLIC_BINDING_REGISTRY=${d.bindingRegistry}`,
    '# Server-only. Enables the TEST QR minting endpoint and the anvil dev wallet.',
    'HB_DEV_MODE=true',
    'NEXT_PUBLIC_DEV_MODE=true',
    '# Circuit artifacts served locally (run: pnpm --filter web link-artifacts).',
    'NEXT_PUBLIC_ARTIFACTS_BASE=/artifacts',
    '',
  ].join('\n');
  writeFileSync(path.join(ROOT, 'apps/web/.env.local'), env);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  deployLocal(process.env.RPC_URL)
    .then((d) => {
      writeDeployment(d);
      console.log(JSON.stringify(d, null, 2));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
