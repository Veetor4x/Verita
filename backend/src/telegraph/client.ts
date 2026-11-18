// Paid /ask calls to Telegraph via x402 (Sepolia USDC), with spend controls.
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config.js';
import { decodeReceipt } from './receipts.js';

export type AskResult = {
  ok: boolean;
  status: number;
  intent: string;
  minerId: string | null; // null = routed (Telegraph picked)
  costUsd: number;
  signalHash?: string;
  receiptHash?: string;
  txHash?: string;
  fieldStatus?: unknown;
  data: any;
  error?: string;
};

let payingFetch: typeof fetch | null = null;

function getPayingFetch(): typeof fetch {
  if (payingFetch) return payingFetch;
  let key = config.evmPrivateKey;
  if (!key) throw new Error('EVM_PRIVATE_KEY is not set');
  if (!key.startsWith('0x')) key = '0x' + key;
  const account = privateKeyToAccount(key as `0x${string}`);
  const client = x402Client.fromConfig({
    schemes: [],
    spendControls: {
      maxAmountPerPayment: '$0.10',
      // Test USDC isn't a "default asset", so allow it explicitly with a $0.10 cap (atomic, 6 decimals).
      allowedAssets: [{ network: config.network, asset: config.usdc, maxAmountPerPayment: '100000' }],
    },
  });
  registerExactEvmScheme(client, { signer: account, networks: [config.network] });
  payingFetch = wrapFetchWithPayment(fetch, client) as typeof fetch;
  return payingFetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Telegraph's facilitator sometimes times out while settling; the server says "Retry". */
function isSettleFailure(status: number, body: any) {
  return status === 402 && typeof body === 'object' && body && /settle/i.test(String(body.reason ?? body.hint ?? ''));
}

/**
 * Buy one answer. If minerId is given we call /ask/{minerId}, otherwise Telegraph routes.
 * `price` is what we expect to pay (from discovery); used only for our own spend accounting.
 */
export async function ask(opts: { intent: string; params: Record<string, unknown>; minerId?: string; expectedPriceUsd?: number }): Promise<AskResult> {
  const path = opts.minerId ? `/engine/v1/ask/${encodeURIComponent(opts.minerId)}` : '/engine/v1/ask';
  const f = getPayingFetch();
  let status = 0; let body: any = null; let headers = new Headers();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await f(config.telegraphBaseUrl + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intent: opts.intent, params: opts.params }),
    });
    status = res.status; headers = res.headers;
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = text; }
    if (!isSettleFailure(status, body)) break;
    await sleep(1500 * attempt);
  }
  const ok = status >= 200 && status < 300;
  const rec = decodeReceipt(headers, body);
  return {
    ok, status,
    intent: opts.intent,
    minerId: opts.minerId ?? (body?.miner_id != null ? String(body.miner_id) : null),
    costUsd: ok ? opts.expectedPriceUsd ?? 0.01 : 0,
    signalHash: rec.signalHash, receiptHash: rec.receiptHash, txHash: rec.txHash,
    fieldStatus: body?.field_status,
    data: body,
    error: ok ? undefined : typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300),
  };
}
