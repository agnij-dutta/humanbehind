// Drives the real web UI headlessly: anvil dev wallet -> register agent ->
// mint TEST QR -> prove in the browser (Web Worker, single-thread) -> bind ->
// public agent page shows the badge.
//
// Prereqs: anvil on :8545, `pnpm tsx scripts/deploy.ts`, `pnpm --filter web link-artifacts`,
// web built and started on :3100. Needs a Chromium: set CHROME=/path/to/chrome
// (e.g. a Playwright-cached "Google Chrome for Testing").
//   CHROME=... OUT=/tmp node scripts/browser-e2e.mjs
import { chromium } from 'playwright-core';
const BASE = process.env.BASE ?? 'http://localhost:3100';
const OUT = process.env.OUT ?? '.';
const exe = process.env.CHROME;
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t = Date.now();
const log = (s) => console.log(`${((Date.now() - t) / 1000).toFixed(1)}s  ${s}`);
try {
  await page.goto(BASE);
  await page.getByRole('button', { name: /Anvil dev #1/ }).click();
  log('connected anvil dev #1');
  await page.getByRole('button', { name: 'Register new agent' }).click();
  await page.getByText(/ERC-8004 agent #\d+/).waitFor({ timeout: 30000 });
  const agentText = await page.getByText(/ERC-8004 agent #\d+/).innerText();
  const agentId = /#(\d+)/.exec(agentText)[1];
  log(`registered agent #${agentId}`);
  await page.getByRole('button', { name: 'Mint TEST QR' }).click();
  await page.getByText(/payload \d+ digits/).waitFor({ timeout: 30000 });
  log('minted TEST QR');
  await page.screenshot({ path: `${OUT}/01-before-prove.png`, fullPage: true });
  await page.getByRole('button', { name: 'Generate proof' }).click();
  const tp = Date.now();
  await page.getByText(/proved in/).waitFor({ timeout: 15 * 60 * 1000 });
  log(
    `PROOF DONE in browser: ${await page.getByText(/proved in/).innerText()} (wall ${((Date.now() - tp) / 1000).toFixed(1)}s)`,
  );
  await page.getByRole('button', { name: 'Bind agent to human' }).click();
  await page.getByText(/^Bound\./).waitFor({ timeout: 60000 });
  log('bound on-chain');
  await page.screenshot({ path: `${OUT}/02-bound.png`, fullPage: true });
  await page.goto(`${BASE}/agent/${agentId}`);
  const badge = await page.locator('.badge').innerText();
  log(`agent page badge: "${badge}"`);
  await page.screenshot({ path: `${OUT}/03-agent-page.png`, fullPage: true });
  if (!badge.includes('Human-verified')) throw new Error('badge missing');
  console.log('BROWSER E2E PASSED');
} catch (e) {
  console.error('FAILED', e);
  await page.screenshot({ path: `${OUT}/fail.png`, fullPage: true });
  process.exitCode = 1;
} finally {
  console.log(
    logs
      .filter((l) => /error|warn/i.test(l))
      .slice(0, 20)
      .join('\n'),
  );
  await browser.close();
}
