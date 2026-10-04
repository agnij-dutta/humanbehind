import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getHumanBacking, evaluate } from '@humanbehind/verifier';
import { agentIdentityRegistryAbi } from '@humanbehind/core';
import { publicClient } from '@/lib/chain';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

const fmt = (d: Date | null) => (d ? d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'n/a');

export default async function AgentPage({ params }: { params: { id: string } }) {
  if (!/^\d+$/.test(params.id)) notFound();
  const agentId = BigInt(params.id);

  let owner: string | null = null;
  try {
    owner = await publicClient.readContract({
      address: config.identityRegistry,
      abi: agentIdentityRegistryAbi,
      functionName: 'ownerOf',
      args: [agentId],
    });
  } catch {
    owner = null;
  }

  let backing;
  try {
    backing = await getHumanBacking(agentId, { client: publicClient, registry: config.bindingRegistry });
  } catch {
    return (
      <main>
        <h1>Agent #{params.id}</h1>
        <div className="warnbox">Could not read the chain at {config.rpcUrl}.</div>
      </main>
    );
  }

  const live = backing.humanBacked;
  const strict = evaluate(backing, {});

  return (
    <main>
      <h1>Agent #{params.id}</h1>
      {!owner && <p className="muted">No ERC-8004 agent with this id on chain {config.chainId}.</p>}

      <div className={`badge${live ? '' : ' off'}`}>
        <span className="dot" />
        {live ? `${backing.testAnchor ? 'TEST · ' : ''}Human-verified · 18+ · unique` : 'Not human-verified'}
      </div>
      {live && backing.testAnchor && (
        <div className="warnbox">
          TEST anchor: this binding used the public anon-aadhaar test key, so it shows the mechanism, not a real person.
          Strict verifiers (the default in @humanbehind/verifier) report it as not human-backed.
        </div>
      )}

      <dl className="facts">
        <dt>Owner</dt>
        <dd className="mono">{owner ?? 'n/a'}</dd>
        <dt>Human id (per-app)</dt>
        <dd className="mono">{live ? `${backing.nullifier.toString().slice(0, 18)}…` : 'n/a'}</dd>
        <dt>Agents this human backs</dt>
        <dd>{live ? `${backing.agentsForHuman} of max ${backing.maxAgentsForHuman}` : 'n/a'}</dd>
        <dt>Bound at</dt>
        <dd>{fmt(backing.boundAt)}</dd>
        <dt>QR signed at</dt>
        <dd>{fmt(backing.qrTimestamp)}</dd>
        <dt>Revealed</dt>
        <dd>age above 18. Name, number, gender, state, pincode, photo: never.</dd>
        <dt>Strict verdict</dt>
        <dd>{strict.ok ? 'human-backed' : `not human-backed (${strict.reasons.join('; ')})`}</dd>
      </dl>

      <p className="small">
        <Link href={`/api/agent/${params.id}`}>Verdict JSON</Link> ·{' '}
        <Link href={`/api/agent/${params.id}/card`}>ERC-8004 registration file</Link> ·{' '}
        <span className="mono muted">registry {config.bindingRegistry}</span>
      </p>
    </main>
  );
}
