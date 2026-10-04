import { NextResponse } from 'next/server';
import { humanBindingRegistryAbi } from '@humanbehind/core';
import { publicClient } from '@/lib/chain';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * ERC-8004 registration file (registration-v1) for an agent registered through
 * this app, with the proposed `humanBacking` extension. This is a POINTER for
 * discovery; verifiers must read the registry they trust, not this JSON.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!/^\d+$/.test(params.id)) return NextResponse.json({ error: 'bad agent id' }, { status: 400 });
  const origin = new URL(req.url).origin;
  let testAnchor = true;
  try {
    testAnchor = await publicClient.readContract({
      address: config.bindingRegistry,
      abi: humanBindingRegistryAbi,
      functionName: 'isTestAnchor',
    });
  } catch {
    /* keep conservative default */
  }
  const id = Number(params.id);
  return NextResponse.json({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: `humanbehind-demo-agent-${id}`,
    description:
      'Demo agent registered via Human Behind the Agent. Carries a zero-knowledge proof that a unique adult human controls it.',
    image: `${origin}/badge.svg`,
    services: [{ name: 'web', endpoint: `${origin}/agent/${id}` }],
    x402Support: false,
    active: true,
    registrations: [{ agentId: id, agentRegistry: `eip155:${config.chainId}:${config.identityRegistry}` }],
    supportedTrust: ['human-backed'],
    humanBacking: [
      {
        type: 'humanbehind/anon-aadhaar-binding-v1',
        bindingRegistry: `eip155:${config.chainId}:${config.bindingRegistry}`,
        agentId: id,
        claims: ['unique-human', 'age-over-18'],
        trustAnchor: testAnchor ? 'anon-aadhaar-test' : 'uidai-offline-kyc',
        check: 'isHumanBacked(uint256)',
      },
    ],
  });
}
