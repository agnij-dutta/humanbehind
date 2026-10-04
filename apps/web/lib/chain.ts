import { createPublicClient, http } from 'viem';
import { chain, config } from './config';

export const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
