'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { decodeEventLog } from 'viem';
import {
  agentIdentityRegistryAbi,
  humanBindingRegistryAbi,
  proofFromJson,
  type BindingProofJson,
} from '@humanbehind/core';
import { publicClient } from '@/lib/chain';
import { config, isConfigured } from '@/lib/config';
import { ANVIL_DEV_ACCOUNTS, connectAnvil, connectInjected, explain, type Wallet } from '@/lib/wallet';
import type { ProveMessage, ProveRequest } from '@/lib/prove.worker';

const reg = { address: config.bindingRegistry, abi: humanBindingRegistryAbi } as const;
const ids = { address: config.identityRegistry, abi: agentIdentityRegistryAbi } as const;

type Qr = { qrData: string; certificatePem: string; resident: string; minor: boolean };
type Chain = { testAnchor: boolean; seed: bigint; maxAgents: bigint };

// Rough single-thread browser estimate from zkdir (~89s) for the progress bar only.
const EXPECTED_PROVE_SEC = 120;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function BindFlow() {
  const [chainInfo, setChainInfo] = useState<Chain | null>(null);
  const [chainErr, setChainErr] = useState<string | null>(() =>
    isConfigured() ? null : 'Registry addresses are not configured. Run scripts/deploy.ts (see README).',
  );
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [agentId, setAgentId] = useState<bigint | null>(null);
  const [agentName, setAgentName] = useState('my-trading-agent');
  const [existingId, setExistingId] = useState('');
  const [qr, setQr] = useState<Qr | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [proof, setProof] = useState<BindingProofJson | null>(null);
  const [bound, setBound] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isConfigured()) return;
    // The trust anchor comes from the contract, never from a client flag.
    Promise.all([
      publicClient.readContract({ ...reg, functionName: 'isTestAnchor' }),
      publicClient.readContract({ ...reg, functionName: 'nullifierSeed' }),
      publicClient.readContract({ ...reg, functionName: 'maxAgentsPerHuman' }),
    ])
      .then(([testAnchor, seed, maxAgents]) => setChainInfo({ testAnchor, seed, maxAgents }))
      .catch(() => setChainErr(`Cannot reach the registry at ${config.rpcUrl}. Is anvil running?`));
  }, []);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(explain(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const send = async (req: Parameters<typeof publicClient.simulateContract>[0]) => {
    if (!wallet) throw new Error('Connect a wallet first.');
    // Simulate first: a free, authoritative pre-check (the contract runs the full groth16 verify).
    const { request } = await publicClient.simulateContract({ ...req, account: wallet.address } as never);
    const hash = await wallet.client.writeContract(request as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error('Transaction reverted.');
    return receipt;
  };

  const registerAgent = () =>
    run(async () => {
      const predicted = await publicClient.readContract({ ...ids, functionName: 'nextAgentId' });
      const uri = `${window.location.origin}/api/agent/${predicted}/card`;
      const receipt = await send({ ...ids, functionName: 'register', args: [uri] } as never);
      let id: bigint | null = null;
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: agentIdentityRegistryAbi, ...log });
          if (ev.eventName === 'Registered') id = ev.args.agentId;
        } catch {
          /* other events */
        }
      }
      if (id === null) throw new Error('Registered event not found.');
      if (id !== predicted) {
        await send({
          ...ids,
          functionName: 'setAgentURI',
          args: [id, `${window.location.origin}/api/agent/${id}/card`],
        } as never);
      }
      setAgentId(id);
    });

  const useExisting = () =>
    run(async () => {
      if (!/^\d+$/.test(existingId)) throw new Error('Agent id must be a number.');
      const id = BigInt(existingId);
      const owner = await publicClient.readContract({ ...ids, functionName: 'ownerOf', args: [id] });
      if (owner.toLowerCase() !== wallet?.address.toLowerCase())
        throw new Error(`Agent #${id} is owned by ${short(owner)}, not this wallet.`);
      setAgentId(id);
    });

  const mintTestQr = (opts: { freshPhoto?: boolean; minor?: boolean }) =>
    run(async () => {
      const res = await fetch('/api/dev/test-qr', { method: 'POST', body: JSON.stringify(opts) });
      if (!res.ok)
        throw new Error((await res.json().catch(() => ({}))).error ?? `test QR endpoint returned ${res.status}`);
      setQr(await res.json());
      setProof(null);
    });

  const prove = () =>
    run(async () => {
      if (!wallet || agentId === null || !qr || !chainInfo) return;
      const signal = await publicClient.readContract({
        ...reg,
        functionName: 'bindSignal',
        args: [agentId, wallet.address],
      });
      setStage('starting');
      setElapsed(0);
      const t0 = Date.now();
      timer.current = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
      try {
        const worker = new Worker(new URL('../lib/prove.worker.ts', import.meta.url), { type: 'module' });
        const req: ProveRequest = {
          qrData: qr.qrData,
          certificatePem: qr.certificatePem,
          nullifierSeed: chainInfo.seed.toString(),
          signal: signal.toString(),
          wasmUrl: `${config.artifactsBase}/aadhaar-verifier.wasm`,
          zkeyUrl: `${config.artifactsBase}/circuit_final.zkey`,
        };
        const result = await new Promise<BindingProofJson>((resolve, reject) => {
          worker.onmessage = (ev: MessageEvent<ProveMessage>) => {
            const m = ev.data;
            if (m.kind === 'stage') setStage(m.stage);
            if (m.kind === 'done') resolve(m.proof);
            if (m.kind === 'error') reject(new Error(m.message));
          };
          worker.onerror = (e) => reject(new Error(e.message || 'prover worker crashed'));
          worker.postMessage(req);
        });
        worker.terminate();
        setProof({ ...result, provingMs: Date.now() - t0 });
      } finally {
        if (timer.current) clearInterval(timer.current);
        setStage(null);
      }
    });

  const bind = () =>
    run(async () => {
      if (!proof || agentId === null) return;
      const p = proofFromJson(proof);
      const receipt = await send({
        ...reg,
        functionName: 'bind',
        args: [agentId, p.nullifier, p.timestamp, p.packed],
      } as never);
      setBound(receipt.transactionHash);
    });

  const revoke = () =>
    run(async () => {
      if (agentId === null) return;
      await send({ ...reg, functionName: 'revokeByOwner', args: [agentId] } as never);
      setBound(null);
      setProof(null);
    });

  const pct = stage ? Math.min(97, Math.round((elapsed / EXPECTED_PROVE_SEC) * 100)) : proof ? 100 : 0;
  const s = (n: number, on: boolean) => `step${on ? '' : ' dim'}`;

  return (
    <div className="steps">
      {chainErr && <div className="warnbox">{chainErr}</div>}
      {chainInfo?.testAnchor && (
        <div className="warnbox">
          This registry trusts the public anon-aadhaar <b>test</b> key (read from the contract). Bindings here are for
          demos only and strict verifiers report them as not human-backed.
        </div>
      )}

      <section className={s(1, true)}>
        <h2>
          <b>01</b>Connect wallet
        </h2>
        {wallet ? (
          <p className="mono">
            {wallet.kind === 'anvil' ? 'anvil dev account ' : ''}
            {wallet.address}
          </p>
        ) : (
          <div className="row">
            <button disabled={busy} onClick={() => run(async () => setWallet(await connectInjected()))}>
              Browser wallet
            </button>
            {config.devMode &&
              chainInfo &&
              config.chainId === 31337 &&
              ANVIL_DEV_ACCOUNTS.map((a, i) => (
                <button
                  key={a}
                  className="ghost"
                  disabled={busy}
                  onClick={() => run(async () => setWallet(connectAnvil(a)))}
                >
                  Anvil dev #{i + 1} ({short(a)})
                </button>
              ))}
          </div>
        )}
      </section>

      <section className={s(2, !!wallet)}>
        <h2>
          <b>02</b>Choose the agent
        </h2>
        {agentId !== null ? (
          <p>
            ERC-8004 agent <b>#{agentId.toString()}</b> on chain {config.chainId}.{' '}
            <Link href={`/agent/${agentId}`}>Public page</Link>
          </p>
        ) : (
          <>
            <div className="row">
              <input value={agentName} onChange={(e) => setAgentName(e.target.value)} aria-label="Agent name" />
              <button disabled={!wallet || busy} onClick={registerAgent}>
                Register new agent
              </button>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <input
                placeholder="existing agent id"
                value={existingId}
                onChange={(e) => setExistingId(e.target.value.trim())}
                aria-label="Existing agent id"
                style={{ width: 170 }}
              />
              <button className="ghost" disabled={!wallet || busy} onClick={useExisting}>
                Use existing
              </button>
            </div>
          </>
        )}
      </section>

      <section className={s(3, agentId !== null)}>
        <h2>
          <b>03</b>Aadhaar Secure QR
        </h2>
        {chainInfo?.testAnchor && config.devMode ? (
          <>
            <div className="row">
              <button disabled={agentId === null || busy} onClick={() => mintTestQr({})}>
                Mint TEST QR
              </button>
              <button
                className="ghost"
                disabled={agentId === null || busy}
                onClick={() => mintTestQr({ freshPhoto: true })}
              >
                New test human
              </button>
              <button className="ghost" disabled={agentId === null || busy} onClick={() => mintTestQr({ minor: true })}>
                Under-18 test human
              </button>
            </div>
            <p className="note">
              Test QRs are UIDAI&apos;s published sample resident (a fictitious person) re-signed with the public test
              key. No real Aadhaar data is used or accepted here.
            </p>
            {qr && (
              <div className="okbox small">
                <b>TEST</b> · {qr.resident}
                {qr.minor ? ' · DOB 2015 (should be rejected)' : ''} · payload {qr.qrData.length} digits
              </div>
            )}
          </>
        ) : (
          <p className="muted small">
            Production QR upload is not part of this build. It only runs against a test-anchored registry with
            HB_DEV_MODE enabled.
          </p>
        )}
      </section>

      <section className={s(4, !!qr)}>
        <h2>
          <b>04</b>Prove in your browser
        </h2>
        <p className="small muted">
          The proof commits to this agent, this wallet, this chain and this registry, and reveals only that the holder
          is 18+. The QR never leaves your browser.
        </p>
        <button disabled={!qr || !!stage || busy || !!bound} onClick={prove}>
          {stage ? `Proving… ${elapsed}s` : proof ? 'Prove again' : 'Generate proof'}
        </button>
        {(stage || proof) && (
          <div className="progress" aria-hidden>
            <i style={{ width: `${pct}%` }} />
          </div>
        )}
        {stage && <p className="note">Stage: {stage}. Single-threaded in a Web Worker; expect one to three minutes.</p>}
        {proof && !stage && (
          <p className="note mono">
            proved in {(proof.provingMs / 1000).toFixed(1)}s · nullifier {proof.nullifier.slice(0, 10)}…
          </p>
        )}
      </section>

      <section className={s(5, !!proof)}>
        <h2>
          <b>05</b>Bind on-chain
        </h2>
        {bound ? (
          <div className="okbox">
            <p style={{ margin: 0 }}>
              Bound. <Link href={`/agent/${agentId}`}>See the public badge for agent #{agentId?.toString()}</Link>
            </p>
            <p className="mono muted" style={{ margin: '6px 0 0' }}>
              tx {bound}
            </p>
            <button className="ghost" style={{ marginTop: 10 }} disabled={busy} onClick={revoke}>
              Revoke binding
            </button>
          </div>
        ) : (
          <button disabled={!proof || busy} onClick={bind}>
            Bind agent to human
          </button>
        )}
        {chainInfo && (
          <p className="note">Policy: at most {chainInfo.maxAgents.toString()} agents per human on this registry.</p>
        )}
      </section>

      {err && <div className="err">{err}</div>}
    </div>
  );
}
