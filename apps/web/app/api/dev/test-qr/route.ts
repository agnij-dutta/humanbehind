// TEST-ONLY: mints a Secure-QR payload for UIDAI's fictitious sample resident,
// re-signed with anon-aadhaar's PUBLIC test key. Gated on the server-only
// HB_DEV_MODE env. Nothing the client sends can change which key the chain
// trusts; this endpoint just produces test inputs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { mintTestQr } from '@humanbehind/core/testqr';
import { humanBindingRegistryAbi } from '@humanbehind/core';
import { publicClient } from '@/lib/chain';
import { config } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fixtures = path.resolve(process.cwd(), '../../dev-fixtures');
const read = (f: string) => readFileSync(path.join(fixtures, f), 'utf8');

export async function POST(req: Request) {
  if (process.env.HB_DEV_MODE !== 'true') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  // Refuse to hand out test QRs against a production-anchored registry: they
  // would fail on-chain anyway, and serving them there only invites confusion.
  try {
    const isTest = await publicClient.readContract({
      address: config.bindingRegistry,
      abi: humanBindingRegistryAbi,
      functionName: 'isTestAnchor',
    });
    if (!isTest) return NextResponse.json({ error: 'registry is production-anchored' }, { status: 409 });
  } catch {
    return NextResponse.json({ error: 'registry unreachable' }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { freshPhoto?: boolean; minor?: boolean };
  const qrData = mintTestQr({
    sampleQr: read('uidai-sample-v1-qr.txt'),
    testPrivateKeyPem: read('testPrivateKey.pem'),
    freshPhoto: body.freshPhoto === true,
    dob: body.minor === true ? '01-01-2015' : undefined,
  });
  return NextResponse.json({
    label: 'TEST',
    resident: body.freshPhoto ? 'UIDAI sample resident (randomized photo: a new test human)' : 'UIDAI sample resident',
    minor: body.minor === true,
    qrData,
    certificatePem: read('testCertificate.pem'),
  });
}
