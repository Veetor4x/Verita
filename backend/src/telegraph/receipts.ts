// Decode receipts from Telegraph / x402 responses and verify signals.
import { config } from '../config.js';

export type DecodedReceipt = {
  signalHash?: string;
  receiptHash?: string;
  txHash?: string;
  raw: Record<string, unknown>;
};

/** Try base64-JSON, then plain JSON, then treat it as a bare hash string. */
export function decodeMaybeJson(value: string | null): Record<string, unknown> | string | null {
  if (!value) return null;
  for (const text of [() => Buffer.from(value, 'base64').toString('utf8'), () => value]) {
    try { return JSON.parse(text()); } catch { /* try next */ }
  }
  return value;
}

const pick = (o: Record<string, unknown> | null, ...keys: string[]): string | undefined => {
  if (!o) return undefined;
  for (const k of keys) { const v = o[k]; if (typeof v === 'string' && v) return v; }
  return undefined;
};

/** Pull signal_hash / receipt_hash out of response headers + JSON body. */
export function decodeReceipt(headers: Headers, body: unknown): DecodedReceipt {
  const telegraphHeader = decodeMaybeJson(headers.get('x-telegraph-receipt'));
  const paymentHeader = decodeMaybeJson(headers.get('x-payment-response') || headers.get('payment-response'));
  const th = typeof telegraphHeader === 'object' ? telegraphHeader : null;
  const ph = typeof paymentHeader === 'object' ? paymentHeader : null;
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;

  const signalHash = pick(th, 'signal_hash', 'signalHash') ?? pick(b, 'signal_hash', 'signalHash')
    ?? pick((b?.receipt as Record<string, unknown>) ?? null, 'signal_hash', 'signalHash');
  // Escrow: receipt_hash lives in X-PAYMENT-RESPONSE. (x402 / X-TELEGRAPH-RECEIPT kept as fallbacks.)
  const receiptHash = pick(ph, 'receipt_hash', 'receiptHash') ?? pick(th, 'receipt_hash', 'receiptHash', 'hash')
    ?? (typeof telegraphHeader === 'string' ? telegraphHeader : undefined)
    ?? pick(b, 'receipt_hash', 'receiptHash')
    ?? pick((b?.receipt as Record<string, unknown>) ?? null, 'receipt_hash', 'receiptHash', 'hash');
  const txHash = pick(ph, 'transaction', 'txHash');
  return { signalHash, receiptHash, txHash, raw: { telegraph: telegraphHeader, payment: paymentHeader } };
}

/** Check a signal hash exists on Telegraph (GET /engine/v1/signal/{hash}). */
export async function verifySignal(signalHash: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${config.telegraphBaseUrl}/engine/v1/signal/${encodeURIComponent(signalHash)}`);
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { ok: res.ok, status: res.status, body };
}
