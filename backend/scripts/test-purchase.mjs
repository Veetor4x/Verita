// One real paid call to URL_SCAN_VERDICT; saves the receipt to Neon and prints the hashes.
// Run: NODE_USE_ENV_PROXY=1 npx tsx scripts/test-purchase.mjs [url]
import { ask } from '../src/telegraph/client.ts';
import { verifySignal } from '../src/telegraph/receipts.ts';
import { migrate, savePurchase } from '../src/db/index.ts';

const url = process.argv[2] || 'https://example.com/';
await migrate();
const r = await ask({ intent: 'URL_SCAN_VERDICT', params: { url }, expectedPriceUsd: 0.01 });
console.log('status      :', r.status, r.ok ? 'OK' : 'FAILED');
if (!r.ok) { console.log('error       :', r.error); process.exit(1); }
console.log('miner       :', r.minerId);
console.log('signal_hash :', r.signalHash);
console.log('receipt_hash:', r.receiptHash);
console.log('payment tx  :', r.txHash);
console.log('field_status:', JSON.stringify(r.fieldStatus));
console.log('answer      :', JSON.stringify(r.data).slice(0, 600));
const id = await savePurchase({ intent: r.intent, minerId: r.minerId, costUsd: r.costUsd, signalHash: r.signalHash, receiptHash: r.receiptHash, txHash: r.txHash, fieldStatus: r.fieldStatus, response: r.data, round: 1 });
console.log('saved to Neon, purchases.id =', id);
if (r.signalHash) { const v = await verifySignal(r.signalHash); console.log('verify signal:', v.status, JSON.stringify(v.body).slice(0, 300)); }
