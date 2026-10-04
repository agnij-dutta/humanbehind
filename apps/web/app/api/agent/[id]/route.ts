import { NextResponse } from 'next/server';
import { getHumanBacking, evaluate } from '@humanbehind/verifier';
import { publicClient } from '@/lib/chain';
import { config } from '@/lib/config';
import { jsonSafe } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

/** Machine-readable verdict. `humanBackedStrict` is what a marketplace should use. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!/^\d+$/.test(params.id)) return NextResponse.json({ error: 'bad agent id' }, { status: 400 });
  try {
    const b = await getHumanBacking(BigInt(params.id), { client: publicClient, registry: config.bindingRegistry });
    const strict = evaluate(b, {});
    const testAllowed = evaluate(b, { allowTestAnchor: true });
    return NextResponse.json(
      jsonSafe({
        agentId: params.id,
        chainId: b.chainId,
        bindingRegistry: b.registry,
        humanBackedStrict: strict.ok,
        humanBackedAllowingTestAnchor: testAllowed.ok,
        reasons: strict.reasons,
        attestation: b,
      }),
    );
  } catch {
    return NextResponse.json({ humanBackedStrict: false, error: 'chain read failed' }, { status: 502 });
  }
}
