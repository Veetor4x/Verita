// Prints a markdown snapshot for docs/RECEIPTS.md: totals, escrow ledger, and one recent purchase per intent.
// Run: NODE_USE_ENV_PROXY=1 npx tsx scripts/receipts-snapshot.mjs
import { sql } from '../src/db/index.ts';
import { privateKeyToAccount } from 'viem/accounts';

let key = process.env.EVM_PRIVATE_KEY ?? ''; if (key && !key.startsWith('0x')) key = '0x' + key;
const wallet = privateKeyToAccount(key).address.toLowerCase(); // public address only; the key is never printed
const [tot] = await sql().query(`select count(*)::int n, count(*) filter (where signal_hash is not null and signal_hash <> '')::int receipts, coalesce(sum(cost_usd),0)::float usd, count(distinct miner_id)::int miners, count(distinct intent)::int intents, min(created_at) first, max(created_at) last from purchases`);
const ledger = await (await fetch(`${process.env.TELEGRAPH_BASE_URL}/v1/ledger/account/${wallet}`)).json();
const rows = await sql().query(`select distinct on (intent) intent, miner_id, round, signal_hash, receipt_hash, created_at from purchases where signal_hash is not null and signal_hash <> '' order by intent, created_at desc`);
const d = (x) => new Date(x).toISOString().slice(0, 16).replace('T', ' ');
console.log(`Snapshot ${d(Date.now())} UTC: **${tot.receipts} receipts**, **$${tot.usd.toFixed(2)}** spent, ${tot.intents} intents, ${tot.miners} different miners (first purchase ${d(tot.first)}, latest ${d(tot.last)}).`);
console.log(`Escrow ledger: deposited $${(Number(ledger.deposited) / 1e6).toFixed(2)}, available $${(Number(ledger.available) / 1e6).toFixed(2)}.\n`);
console.log('| Intent | Miner | Round | signal_hash | receipt_hash |\n|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.intent} | ${r.miner_id} | ${r.round} | \`${r.signal_hash}\` | \`${r.receipt_hash ?? ''}\` |`);
