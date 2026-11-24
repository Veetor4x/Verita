// Prints the exact bot reply for one live check of each type (real engine, real reply formatter; not sent via Telegram).
// Run: NODE_USE_ENV_PROXY=1 npx tsx scripts/reply-examples.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from '../src/db/index.ts';
import { runCheck } from '../src/engine/run.ts';
import { analyseImage } from '../src/engine/checks/image.ts';
import { findLookalikes, addressesOfResult } from '../src/engine/lookalike.ts';
import { imageReply, simpleReply } from '../src/bot/simple.ts';

const show = (title, view, cost) => {
  const btn = ['More details', view.officialUrl && 'Official site', view.sources && view.sources.label].filter(Boolean).map((b) => `[${b}]`).join(' ');
  console.log(`\n── ${title}${cost !== undefined ? `  (cost $${cost.toFixed(2)}, not shown to the user)` : ''}\n${view.text}\n${btn}`);
};
await migrate();

const link = (url) => runCheck({ kind: 'LINK', value: url });
const safe = await link('https://www.google.com/');                       show('LINK, safe', simpleReply(safe), safe.details.totalCostUsd);
const scam = await link('http://metamask-wallet-verify.xyz/connect');     show('LINK, scam', simpleReply(scam), scam.details.totalCostUsd);
const claim = await runCheck({ kind: 'CLAIM', value: 'Drinking bleach cures COVID-19.' }); show('CLAIM (false)', simpleReply(claim), claim.details.totalCostUsd);
const tx = await runCheck({ kind: 'TX', value: '0x3cdb78fd28dd818281b08abd4f9c42aaf7de9624fbb37d95bdb3151e7cca2ac6' }); show('PAYMENT (mainnet USDT transfer)', simpleReply(tx), tx.details.totalCostUsd);
const sepTx = await runCheck({ kind: 'TX', value: '0xd2532682c31e8060a310e38fc6aaad7af50404801e760ae6983fb343bac0ca57' }); show('PAYMENT (to a smart contract)', simpleReply(sepTx), sepTx.details.totalCostUsd);

const REAL = '0xd7a193Ae8a09b5BDc7E0888AFa51C20759bd9E68';              // our burner wallet (public address)
const wallet = await runCheck({ kind: 'ADDRESS', value: REAL });         show('ADDRESS (wallet)', simpleReply(wallet), wallet.details.totalCostUsd);
const FAKE = REAL.slice(0, 6) + 'c'.repeat(32) + REAL.slice(-4);          // same first 4 and last 4 characters, different middle
const fakeRes = await runCheck({ kind: 'ADDRESS', value: FAKE });
const same = findLookalikes(addressesOfResult(fakeRes.input, fakeRes.details.facts)[0], [REAL.toLowerCase()]);
show('ADDRESS look-alike (chat had checked the wallet before)', simpleReply(fakeRes, { lookalike: same.length ? { now: FAKE.toLowerCase(), before: same[0] } : undefined }), fakeRes.details.totalCostUsd);

const dir = fileURLToPath(new URL('../../docs/test-images/', import.meta.url));
const img = await analyseImage(readFileSync(dir + 'fake-bank-alert.png'), { run: runCheck });
show('IMAGE (fake bank alert screenshot)', imageReply(img.summary, img.items), img.summary.details.totalCostUsd);
