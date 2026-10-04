'use client';
import { createWalletClient, custom, http, type Address, type WalletClient, BaseError, ContractFunctionRevertedError } from 'viem';
import { chain, config } from './config';

/** anvil default accounts #1 and #2. anvil signs for them itself (unlocked), so no key ships to the browser. */
export const ANVIL_DEV_ACCOUNTS: Address[] = [
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
];

export type Wallet = { client: WalletClient; address: Address; kind: 'injected' | 'anvil' };

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

export async function connectInjected(): Promise<Wallet> {
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new Error('No browser wallet found.');
  const client = createWalletClient({ chain, transport: custom(eth) });
  const [address] = await client.requestAddresses();
  try {
    await client.switchChain({ id: chain.id });
  } catch {
    await client.addChain({ chain });
  }
  return { client, address, kind: 'injected' };
}

export function connectAnvil(address: Address): Wallet {
  if (!config.devMode || chain.id !== 31337) throw new Error('Dev wallet is only available on a local anvil chain.');
  const client = createWalletClient({ account: address, chain, transport: http(config.rpcUrl) });
  return { client, address, kind: 'anvil' };
}

const FRIENDLY: Record<string, string> = {
  NotAgentOwner: 'This wallet does not own that agent.',
  AlreadyBound: 'This agent is already bound to a human.',
  InvalidProof: 'The proof did not verify for this agent, wallet, chain and registry.',
  ProofExpired: 'The QR is too old. Generate a fresh one.',
  ProofFromFuture: 'The QR timestamp is in the future. Check your clock.',
  HumanAgentLimit: 'This human already backs the maximum number of agents.',
  NotBound: 'This agent has no binding.',
};

export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? '';
      return FRIENDLY[name] ?? `Reverted: ${name || revert.shortMessage}`;
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
