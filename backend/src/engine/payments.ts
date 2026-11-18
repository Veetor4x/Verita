// Payment check logic: parse lookup answers, format amounts, decide the verdict. Pure functions, no network.
import type { Verdict } from '../../../shared/types.js';

export type TxStatus = 'confirmed' | 'pending' | 'failed' | 'not_found' | 'unknown';
export type TokenTransfer = { amount: number; symbol: string; from: string; to: string };
export type Lookup = {
  found: boolean; status: TxStatus; from?: string; to?: string; valueEth: number;
  /** The tx carried calldata (a contract call), so `to` is a contract. */
  hasCalldata: boolean; method?: string; token?: TokenTransfer; confirmations?: number;
};

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const addr = (v: unknown): string | undefined => (typeof v === 'string' && ADDR.test(v) ? v.toLowerCase() : undefined);

// "The call transferred 12.856392 USDT (raw 12856392) from 0x98b1... to 0x5d8f..."
const TRANSFER_RE = /transferred\s+([\d,]*\.?\d+)\s+([A-Za-z0-9._$-]{1,12})(?:\s*\(raw[^)]*\))?\s+from\s+(0x[0-9a-fA-F]{40})\s+to\s+(0x[0-9a-fA-F]{40})/i;

/** Read one Telegraph ONCHAIN_TX_LOOKUP answer (canonical or the richer native one). */
export function parseLookup(body: any): Lookup {
  const r = body?.result ?? {};
  const from = addr(r.from); const to = addr(r.to);
  const raw = String(r.status ?? '').toLowerCase(); const receipt = String(r.receipt_status ?? '').toLowerCase();
  let status: TxStatus;
  if (/fail|revert/.test(receipt) || receipt === '0' || /fail|revert/.test(raw)) status = 'failed';
  else if (/confirm|success|final|included/.test(raw) || /success/.test(receipt)) status = 'confirmed';
  else if (/pend|mempool|queue/.test(raw)) status = 'pending';
  else if (!from || /not.?found|missing/.test(raw)) status = 'not_found';
  else status = 'unknown';

  let valueEth = Number(r.value_eth);
  if (!Number.isFinite(valueEth)) { try { valueEth = r.value_wei != null ? Number(BigInt(String(r.value_wei))) / 1e18 : 0; } catch { valueEth = 0; } }
  const sel = typeof r.method_selector === 'string' ? r.method_selector : '';
  const text = [r.answer, r.summary].filter((x) => typeof x === 'string').join(' ');
  const m = text.match(TRANSFER_RE);
  const amount = m ? Number(m[1].replace(/,/g, '')) : NaN;
  return {
    found: !!from && status !== 'not_found', status, from, to, valueEth,
    hasCalldata: (sel !== '' && sel !== '0x') || (typeof r.method === 'string' && r.method !== ''),
    method: typeof r.method === 'string' && r.method ? r.method : undefined,
    token: m && Number.isFinite(amount) ? { amount, symbol: m[2].toUpperCase(), from: m[3].toLowerCase(), to: m[4].toLowerCase() } : undefined,
    confirmations: Number.isFinite(Number(r.confirmations)) ? Number(r.confirmations) : undefined,
  };
}

// ---- formatting ----
export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function fmtAmount(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return n.toFixed(6).replace(/\.?0+$/, '') || '0';
}
export const fmtUsd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const STATUS_TEXT: Record<TxStatus, string> = {
  confirmed: 'Confirmed ✅', pending: 'Pending ⏳', failed: 'Failed ❌ (no funds moved)', not_found: 'Not found', unknown: 'Unknown',
};

/** One label per purchase, e.g. ['transaction lookup', 'transaction lookup', 'price'] -> "3 checks bought: transaction lookup ×2, price." */
export function paymentBoughtLine(labels: string[]): string {
  const n = labels.length;
  if (n === 0) return 'Nothing was bought: read straight from the network.';
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  const parts = [...counts].map(([l, c]) => (c > 1 ? `${l} ×${c}` : l));
  return `${n} check${n > 1 ? 's' : ''} bought: ${parts.join(', ')}.`;
}

// ---- verdicts ----
export type TxVerdictInput = {
  /** Did any network know this tx? */
  found: boolean;
  /** Were all networks actually checked? false = some did not answer, so "not found" is not certain. */
  checkedAll: boolean;
  status: TxStatus;
  /** Is the real recipient a smart contract? null = could not tell. */
  recipientContract: boolean | null;
  riskHigh: boolean;
  network: string;
  boughtLine: string;
};

export function txVerdict(i: TxVerdictInput): { verdict: Verdict; reasons: string[] } {
  let verdict: Verdict; let why: string;
  if (!i.found) {
    verdict = 'CAREFUL';
    why = i.checkedAll ? 'We could not find this transaction on the networks we check. Double-check the hash.' : 'We could not find this transaction, and some networks did not answer, so it may still exist.';
  } else if (i.status === 'failed') { verdict = 'CAREFUL'; why = 'This transaction failed, so no funds moved.'; }
  else if (i.status === 'pending') { verdict = 'CAREFUL'; why = 'This transaction is still pending: it has not been confirmed yet.'; }
  else if (i.recipientContract === true) {
    verdict = i.riskHigh ? 'SCAM' : 'CAREFUL';
    why = i.riskHigh ? 'The funds went to a smart contract and the risk screen rates it high. Do not trust it.' : 'The funds went to a smart contract, not a normal wallet. Make sure you trust it.';
  } else if (i.riskHigh) { verdict = 'CAREFUL'; why = 'The risk screen rates this payment high risk.'; }
  else if (i.status === 'unknown') { verdict = 'CAREFUL'; why = 'We found the transaction but could not confirm its status.'; }
  else {
    verdict = 'SAFE';
    why = i.recipientContract === false ? `Confirmed on ${i.network}: the funds went to a normal wallet.` : `Confirmed on ${i.network}. We could not tell whether the recipient is a wallet or a contract.`;
  }
  return { verdict, reasons: [why, i.boughtLine].slice(0, 3) };
}

export type AddrVerdictInput = {
  /** Networks where the address has code, a balance or past transactions. */
  activeNetworks: string[]; contract: boolean; unknownChains: number; riskHigh: boolean; boughtLine: string;
};

export function addressVerdict(i: AddrVerdictInput): { verdict: Verdict; reasons: string[] } {
  let verdict: Verdict; let why: string;
  if (i.activeNetworks.length === 0) {
    verdict = 'CAREFUL';
    why = i.unknownChains > 0 ? 'We could not reach the networks to check this address.' : 'No activity found for this address on the networks we check. It may be brand new or unused.';
  } else if (i.contract) {
    verdict = i.riskHigh ? 'SCAM' : 'CAREFUL';
    why = i.riskHigh ? 'This address is a smart contract and the risk screen rates it high. Do not send funds.' : 'This address is a smart contract, not a normal wallet. Make sure you trust it before sending funds.';
  } else if (i.riskHigh) { verdict = 'CAREFUL'; why = 'This wallet is rated high risk by the risk screen.'; }
  else { verdict = 'SAFE'; why = 'This is a normal wallet (not a smart contract). That alone does not prove the owner is trustworthy.'; }
  return { verdict, reasons: [why, i.boughtLine].slice(0, 3) };
}

/** Read a TRANSACTION_RISK_GENERAL answer: only an explicit HIGH / CRITICAL (or a high numeric score) counts as risky. */
export function isHighRisk(body: any): boolean {
  const r = body?.result ?? {};
  const level = String(r.risk_level ?? '').toLowerCase();
  if (/high|critical|severe/.test(level)) return true;
  const score = Number(r.risk_score);
  return Number.isFinite(score) && score >= 0.7 && !/low|medium/.test(level);
}

/** A usable USD price from a CRYPTO_PRICE_USD answer, or null. */
export function readPriceUsd(body: any): number | null {
  const p = Number(body?.result?.price_usd);
  return Number.isFinite(p) && p > 0 ? p : null;
}
