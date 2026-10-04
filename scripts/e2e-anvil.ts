// Headless end-to-end on a fresh anvil chain, using the same packages the web
// app uses:
//   deploy (TEST anchor) -> register ERC-8004 agent -> read bind signal from
//   chain -> mint TEST QR -> prove (real groth16) -> bind tx -> verifier lib
//   -> card claim check -> transfer kills badge -> Sybil cap.
//
//   pnpm e2e              (starts its own anvil on :8546)
import { spawn } from 'node:child_process';
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { humanBindingRegistryAbi, agentIdentityRegistryAbi, computeBindSignal } from '@humanbehind/core';
import { proveBinding } from '@humanbehind/core/prover';
import { mintTestQr } from '@humanbehind/core/testqr';
import { isHumanBacked, getHumanBacking, verifyCardClaim, evaluate } from '@humanbehind/verifier';
import { deployLocal } from './deploy.js';
import { WASM, ZKEY, devFixture } from './common.js';

const RPC = 'http://127.0.0.1:8546';
// anvil default accounts #1 and #2 (public dev keys).
const ALICE: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const BOB: Hex = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

const step = (s: string) => console.log(`\n== ${s}`);
const check = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`  ok  ${msg}`);
};

async function main() {
  const anvil = spawn('anvil', ['--port', '8546', '--silent'], { stdio: 'ignore' });
  process.on('exit', () => anvil.kill());
  await new Promise((r) => setTimeout(r, 1500));

  const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
  const alice = createWalletClient({ account: privateKeyToAccount(ALICE), chain: foundry, transport: http(RPC) });
  const bob = createWalletClient({ account: privateKeyToAccount(BOB), chain: foundry, transport: http(RPC) });

  step('deploy (TEST anchor)');
  const d = await deployLocal(RPC, 2n);
  console.log(`  bindingRegistry ${d.bindingRegistry}\n  identityRegistry ${d.identityRegistry}`);
  const reg = { address: d.bindingRegistry, abi: humanBindingRegistryAbi } as const;
  const ids = { address: d.identityRegistry, abi: agentIdentityRegistryAbi } as const;
  check((await pub.readContract({ ...reg, functionName: 'isTestAnchor' })) === true, 'registry reports test anchor');

  const send = async (w: typeof alice, req: Parameters<typeof alice.writeContract>[0]) => {
    const hash = await w.writeContract(req);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') throw new Error('tx reverted');
    return r;
  };
  const register = async (w: typeof alice, uri: string) => {
    const { result } = await pub.simulateContract({ ...ids, functionName: 'register', args: [uri], account: w.account });
    await send(w, { ...ids, functionName: 'register', args: [uri] } as never);
    return result;
  };

  step('register ERC-8004 agent');
  const agentId = await register(alice, 'data:application/json,{"name":"demo-agent"}');
  check(agentId === 1n, `alice owns agent #${agentId}`);

  step('read bind signal from chain, cross-check with off-chain computation');
  const signal = await pub.readContract({ ...reg, functionName: 'bindSignal', args: [agentId, alice.account.address] });
  const nonce = await pub.readContract({ ...reg, functionName: 'nonceOf', args: [agentId] });
  const offchain = computeBindSignal({
    chainId: d.chainId, registry: d.bindingRegistry, identityRegistry: d.identityRegistry, agentId, owner: alice.account.address, nonce,
  });
  check(signal === offchain, 'on-chain bindSignal == computeBindSignal');
  const seed = await pub.readContract({ ...reg, functionName: 'nullifierSeed' });

  step('mint TEST QR + prove (real groth16, multi-thread node)');
  const qrData = mintTestQr({ sampleQr: devFixture('uidai-sample-v1-qr.txt'), testPrivateKeyPem: devFixture('testPrivateKey.pem') });
  const proof = await proveBinding({
    qrData, certificatePem: devFixture('testCertificate.pem'), nullifierSeed: seed, signal, wasm: WASM, zkey: ZKEY,
    singleThread: false,
  });
  console.log(`  proving time: ${proof.provingMs} ms`);

  step('bind');
  const g = await pub.estimateContractGas({
    ...reg, functionName: 'bind', args: [agentId, proof.nullifier, proof.timestamp, proof.packed], account: alice.account,
  });
  console.log(`  estimated gas: ${g}`);
  await send(alice, { ...reg, functionName: 'bind', args: [agentId, proof.nullifier, proof.timestamp, proof.packed] } as never);

  step('verifier lib');
  check((await isHumanBacked(agentId, { client: pub, registry: d.bindingRegistry })) === false,
    'isHumanBacked() is FALSE by default for a test-anchor registry (fail closed)');
  check((await isHumanBacked(agentId, { client: pub, registry: d.bindingRegistry, allowTestAnchor: true })) === true,
    'isHumanBacked(allowTestAnchor) is true');
  const b = await getHumanBacking(agentId, { client: pub, registry: d.bindingRegistry });
  check(b.nullifier === proof.nullifier && b.ageAbove18, 'attestation records nullifier + 18+');
  console.log(`  verdict without test allowance: ${evaluate(b, {}).reasons.join('; ')}`);

  const card = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'demo-agent',
    registrations: [{ agentId: Number(agentId), agentRegistry: `eip155:${d.chainId}:${d.identityRegistry}` }],
    supportedTrust: ['human-backed'],
    humanBacking: [{
      type: 'humanbehind/anon-aadhaar-binding-v1', bindingRegistry: `eip155:${d.chainId}:${d.bindingRegistry}`,
      agentId: Number(agentId), claims: ['unique-human', 'age-over-18'], trustAnchor: 'anon-aadhaar-test', check: 'isHumanBacked(uint256)',
    }],
  };
  check(await verifyCardClaim(card, { client: pub, trustedRegistries: [d.bindingRegistry], allowTestAnchor: true }), 'card claim verifies against trusted registry');
  check(!(await verifyCardClaim(card, { client: pub, trustedRegistries: ['0x000000000000000000000000000000000000dEaD' as Address], allowTestAnchor: true })),
    'card claim pointing at an untrusted registry is ignored');

  step('Sybil cap = 2: same human, second agent ok, third rejected');
  const agent2 = await register(alice, 'data:,agent2');
  const agent3 = await register(bob, 'data:,agent3'); // different wallet, same human
  const p2 = await proveBinding({
    qrData, certificatePem: devFixture('testCertificate.pem'), nullifierSeed: seed,
    signal: await pub.readContract({ ...reg, functionName: 'bindSignal', args: [agent2, alice.account.address] }),
    wasm: WASM, zkey: ZKEY, singleThread: false,
  });
  console.log(`  proving time: ${p2.provingMs} ms`);
  await send(alice, { ...reg, functionName: 'bind', args: [agent2, p2.nullifier, p2.timestamp, p2.packed] } as never);
  check(p2.nullifier === proof.nullifier, 'same human => same nullifier across agents');
  const p3 = await proveBinding({
    qrData, certificatePem: devFixture('testCertificate.pem'), nullifierSeed: seed,
    signal: await pub.readContract({ ...reg, functionName: 'bindSignal', args: [agent3, bob.account.address] }),
    wasm: WASM, zkey: ZKEY, singleThread: false,
  });
  console.log(`  proving time: ${p3.provingMs} ms`);
  let rejected = false;
  try {
    await pub.simulateContract({ ...reg, functionName: 'bind', args: [agent3, p3.nullifier, p3.timestamp, p3.packed], account: bob.account });
  } catch (e) {
    rejected = String(e).includes('HumanAgentLimit');
  }
  check(rejected, 'third agent (even from another wallet) rejected with HumanAgentLimit');

  step('transfer kills the badge');
  await send(alice, { ...ids, functionName: 'transferFrom', args: [alice.account.address, bob.account.address, agentId] } as never);
  check((await isHumanBacked(agentId, { client: pub, registry: d.bindingRegistry, allowTestAnchor: true })) === false,
    'after transfer, agent is no longer human-backed');

  console.log('\nE2E PASSED');
  anvil.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
