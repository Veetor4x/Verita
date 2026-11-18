// Paid /ask calls to Telegraph.
//   1. ESCROW first: deposit USDC once, then each call is just a signed message (no facilitator).
//   2. x402 per-call (Sepolia USDC, with spend controls) as fallback.
// Set PAYMENT_MODE=escrow|x402 to force one rail.
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { decodeReceipt } from './receipts.js';

export type AskResult = {
  ok: boolean;
  status: number;
  rail: 'escrow' | 'x402' | 'none';
  intent: string;
  minerId: string | null; // the miner that answered
  costUsd: number;
  signalHash?: string;
  receiptHash?: string;
  txHash?: string; // x402 only (escrow settles per epoch on Telegraph's ledger)
  fieldStatus?: unknown;
  data: any;
  error?: string;
};

function getAccount() {
  let key = config.evmPrivateKey;
  if (!key) throw new Error('EVM_PRIVATE_KEY is not set');
  if (!key.startsWith('0x')) key = '0x' + key;
  return privateKeyToAccount(key as `0x${string}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const parseBody = (text: string) => { try { return JSON.parse(text); } catch { return text; } };

// ---------- escrow rail ----------
let escrowEmptyUntil = 0; // after an "insufficient" refusal, skip escrow for 5 min (a deposit resets it)

/** The X-PAYMENT header: a personal_sign of the challenge's message. It proves intent; it can't move funds. */
async function escrowHeader(req: any): Promise<string> {
  const account = getAccount();
  const template = String(req?.extra?.message || '');
  if (!template) throw new Error('escrow challenge has no message to sign');
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address, to: req.payTo, value: req.amount,
    validAfter: String(now - 10), validBefore: String(now + 60), // node allows a window of 2 min at most
    nonce: '0x' + randomBytes(32).toString('hex'),
  };
  // The node rebuilds the message with the wallet lowercased.
  const message = template
    .replaceAll('{from}', authorization.from.toLowerCase())
    .replaceAll('{nonce}', authorization.nonce)
    .replaceAll('{validAfter}', authorization.validAfter)
    .replaceAll('{validBefore}', authorization.validBefore);
  const signature = await account.signMessage({ message });
  const envelope = { x402Version: 2, scheme: 'escrow', network: req.network, payload: { signature, authorization } };
  return Buffer.from(JSON.stringify(envelope)).toString('base64');
}

// ---------- x402 rail ----------
let payingFetch: typeof fetch | null = null;
function getPayingFetch(): typeof fetch {
  if (payingFetch) return payingFetch;
  const client = x402Client.fromConfig({
    schemes: [],
    spendControls: {
      maxAmountPerPayment: '$0.10',
      // Test USDC isn't a "default asset", so allow it explicitly with a $0.10 cap (atomic, 6 decimals).
      allowedAssets: [{ network: config.network, asset: config.usdc, maxAmountPerPayment: '100000' }],
    },
  });
  registerExactEvmScheme(client, { signer: getAccount(), networks: [config.network] });
  payingFetch = wrapFetchWithPayment(fetch, client) as typeof fetch;
  return payingFetch;
}

/** Telegraph's facilitator sometimes times out while settling; the server says "Retry". */
const isSettleFailure = (status: number, body: any) =>
  status === 402 && typeof body === 'object' && body && /settle/i.test(String(body.reason ?? body.hint ?? ''));

type Raw = { status: number; headers: Headers; body: any };
async function post(url: string, body: string, extra: Record<string, string> = {}, f: typeof fetch = fetch): Promise<Raw> {
  const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body });
  return { status: res.status, headers: res.headers, body: parseBody(await res.text()) };
}

/**
 * Buy one answer. With minerId we call /ask/{minerId}; otherwise Telegraph routes.
 * expectedPriceUsd is only a fallback for our spend accounting; the answer's cost_usd wins.
 */
export async function ask(opts: { intent: string; params: Record<string, unknown>; minerId?: string; expectedPriceUsd?: number; rawBody?: unknown }): Promise<AskResult> {
  const url = config.telegraphBaseUrl + (opts.minerId ? `/engine/v1/ask/${encodeURIComponent(opts.minerId)}` : '/engine/v1/ask');
  // rawBody: native {method, endpoint, payload} body for /ask/{minerId}, for miners the router cannot map.
  const body = JSON.stringify(opts.rawBody ?? { intent: opts.intent, params: opts.params });
  const mode = config.paymentMode;
  let raw: Raw | null = null;
  let rail: AskResult['rail'] = 'none';
  let escrowNote = '';

  // 1. Unpaid request -> 402 challenge listing the payment options.
  const challenge = await post(url, body);
  if (challenge.status !== 402) {
    raw = challenge; // already answered, or a real error (bad body etc.)
  } else {
    const required = decodeRequired(challenge.headers);
    const escrow = required.find((a: any) => a.scheme === 'escrow' && a.network === config.network);

    // 2. Escrow rail.
    if (!raw && escrow && mode !== 'x402' && (mode === 'escrow' || Date.now() >= escrowEmptyUntil)) {
      const r = await post(url, body, { 'X-PAYMENT': await escrowHeader(escrow) });
      if (r.status !== 402) { raw = r; rail = 'escrow'; }
      else {
        escrowNote = String(r.body?.reason || r.body?.error || 'escrow refused');
        if (/insufficient/i.test(escrowNote)) escrowEmptyUntil = Date.now() + 5 * 60_000;
        if (mode === 'escrow') { raw = r; rail = 'escrow'; }
      }
    }

    // 3. x402 fallback (also when escrow is empty / refused).
    if (!raw && mode !== 'escrow') {
      const f = getPayingFetch();
      let r: Raw = { status: 0, headers: new Headers(), body: null };
      for (let attempt = 1; attempt <= 3; attempt++) {
        r = await post(url, body, {}, f);
        if (!isSettleFailure(r.status, r.body)) break;
        await sleep(1500 * attempt);
      }
      raw = r; rail = 'x402';
    }
  }

  const r = raw ?? challenge;
  const ok = r.status >= 200 && r.status < 300;
  const rec = decodeReceipt(r.headers, r.body);
  const b = r.body && typeof r.body === 'object' ? r.body : {};
  const err = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  return {
    ok, status: r.status, rail, intent: opts.intent,
    minerId: b.miner_id != null ? String(b.miner_id) : opts.minerId ?? null,
    costUsd: ok ? Number(b.cost_usd ?? opts.expectedPriceUsd ?? 0.01) : 0,
    signalHash: rec.signalHash, receiptHash: rec.receiptHash, txHash: rec.txHash,
    fieldStatus: b.field_status,
    data: r.body,
    error: ok ? undefined : `${escrowNote ? `[escrow: ${escrowNote}] ` : ''}${err.slice(0, 300)}`,
  };
}

function decodeRequired(headers: Headers): any[] {
  const h = headers.get('payment-required');
  if (!h) return [];
  try { return JSON.parse(Buffer.from(h, 'base64').toString('utf8')).accepts ?? []; } catch { return []; }
}
