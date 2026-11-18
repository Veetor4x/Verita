// Payment check (basic): a tx hash or an address -> network, from -> to, wallet vs contract, amount + USD, status.
//
// Free public-RPC reads find the network and tell wallets from contracts. Paid Telegraph purchases do the rest:
//   ONCHAIN_TX_LOOKUP_GENERAL (the lookup), CRYPTO_PRICE_USD (USD value), TRANSACTION_RISK_GENERAL (only when risky).
// Telegraph has no miners for testnets, so testnet transactions are read straight from the RPC and nothing is bought.
// If a mainnet RPC does not answer, we do not guess: we probe the networks through Telegraph, one at a time.
import { randomUUID } from 'node:crypto';
import type { CheckResult } from '../../../../shared/types.js';
import { buy, SpendTracker, type Purchase } from '../planner.js';
import { minersWithEndpoint, pickMiners } from '../../telegraph/discovery.js';
import { findTx, inspectAddress, isContract, receiptStatus, weiHexToNumber, type ChainInfo } from '../chain.js';
import {
  addressVerdict, fmtAmount, fmtUsd, isHighRisk, parseLookup, paymentBoughtLine, readPriceUsd, STATUS_TEXT, txVerdict,
  type Lookup, type TxStatus,
} from '../payments.js';

const LOOKUP = 'ONCHAIN_TX_LOOKUP_GENERAL';

type Ctx = { id: string; tracker: SpendTracker; bought: Purchase[]; labels: string[] };
const newCtx = async (): Promise<Ctx> => ({ id: randomUUID().slice(0, 8), tracker: await SpendTracker.create(), bought: [], labels: [] });

async function purchase(ctx: Ctx, label: string, ...args: Parameters<typeof buy> extends [string, ...infer R] ? R : never): Promise<Purchase | null> {
  const p = await buy(ctx.id, ...args).catch(() => null);
  // Only answers we actually got (and paid for) count as bought; a failed ask is not charged and has no receipt.
  if (p?.ok) { ctx.bought.push(p); ctx.labels.push(label); } // one label per purchase
  return p;
}

/** Lookup through Telegraph. Prefers the richest miner we can discover (one exposing /check-tx: decodes token transfers). */
async function lookupViaTelegraph(ctx: Ctx, hash: string, chain: ChainInfo): Promise<Lookup | null> {
  const params = { tx_hash: hash, chain: chain.telegraph };
  const ranked = await pickMiners(LOOKUP, 30, []).catch(() => []);
  const rich = await minersWithEndpoint(LOOKUP, '/check-tx');
  const richMiner = ranked.find((m) => rich.has(m.id));
  if (richMiner) {
    const p = await purchase(ctx, 'transaction lookup', { intent: LOOKUP, params }, 1, ctx.tracker, richMiner.id, { method: 'GET', endpoint: '/check-tx', payload: params });
    if (p?.ok) return parseLookup(p.data);
  }
  const top = ranked.find((m) => m.id !== richMiner?.id);
  if (!top) return null;
  const p = await purchase(ctx, 'transaction lookup', { intent: LOOKUP, params }, 1, ctx.tracker, top.id);
  return p?.ok ? parseLookup(p.data) : null;
}

/** USD price of a symbol from the best-ranked price miners (tries the top two). */
async function priceOf(ctx: Ctx, symbol: string): Promise<number | null> {
  for (const m of await pickMiners('CRYPTO_PRICE_USD', 2, []).catch(() => [])) {
    const p = await purchase(ctx, 'price', { intent: 'CRYPTO_PRICE_USD', params: { symbol } }, 1, ctx.tracker, m.id);
    const price = p?.ok ? readPriceUsd(p.data) : null;
    if (price) return price;
  }
  return null;
}

/** Risk screen (only bought when something already looks risky). Some miners cannot screen tx hashes: try the top two. */
async function riskHigh(ctx: Ctx, subject: string): Promise<boolean> {
  for (const m of await pickMiners('TRANSACTION_RISK_GENERAL', 2, []).catch(() => [])) {
    const p = await purchase(ctx, 'risk screen', { intent: 'TRANSACTION_RISK_GENERAL', params: { transaction: subject } }, 2, ctx.tracker, m.id);
    if (p?.ok && (p.data?.result?.risk_level != null || p.data?.result?.risk_score != null)) return isHighRisk(p.data);
  }
  return false;
}

const finish = (ctx: Ctx, input: string, v: { verdict: CheckResult['verdict']; reasons: string[] }, facts: { label: string; value: string }[], miners: string[] = []): CheckResult => ({
  id: ctx.id, kind: 'PAYMENT', input, verdict: v.verdict, reasons: v.reasons,
  officialCheck: { status: 'NOT_FOUND', links: [] },
  details: {
    sources: [], miners: [...new Set([...ctx.bought.map((p) => p.receipt.minerId), ...miners])],
    receipts: ctx.bought.map((p) => p.receipt), totalCostUsd: ctx.tracker.spent, cached: false, facts,
  },
  createdAt: Date.now(),
});

const rpcStatus = (s: Awaited<ReturnType<typeof receiptStatus>>): TxStatus => (s === 'success' ? 'confirmed' : s === 'failed' ? 'failed' : s === 'pending' ? 'pending' : 'unknown');

export async function checkTx(hash: string): Promise<CheckResult> {
  const ctx = await newCtx();
  const search = await findTx(hash);
  let chain: ChainInfo | null = search.found?.chain ?? null;
  let lookup: Lookup | null = null;

  // Where could this tx be, as far as Telegraph can see? Known chain, or the chains whose RPC did not answer.
  const candidates = chain ? (chain.telegraph ? [chain] : []) : search.unknown.filter((c) => c.telegraph);
  let probeFailed = false;
  for (const c of candidates) {
    const l = await lookupViaTelegraph(ctx, hash, c);
    if (!l) probeFailed = true;
    if (l?.found) { lookup = l; chain = c; break; }
    if (chain) break; // we know the chain; no point trying others
  }

  const rpcTx = chain && search.found?.chain.key === chain.key ? search.found.tx : undefined;
  if (!chain || (!lookup && !rpcTx)) {
    // "Not found" is only certain when every network answered (or was probed through Telegraph without a failure).
    const checkedAll = !probeFailed && search.unknown.every((c) => !!c.telegraph);
    const v = txVerdict({ found: false, checkedAll, status: 'not_found', recipientContract: null, riskHigh: false, network: '', boughtLine: paymentBoughtLine(ctx.labels) });
    return finish(ctx, hash, v, [{ label: 'Status', value: STATUS_TEXT.not_found }]);
  }

  // Facts: Telegraph's answer when we have one, otherwise straight from the RPC (testnets).
  let status: TxStatus; let from: string | undefined; let to: string | undefined; let valueEth: number; let hasCalldata: boolean;
  if (lookup) {
    ({ status, from, to, valueEth, hasCalldata } = lookup);
  } else {
    const tx = rpcTx!; // checked above: we have a lookup or an RPC transaction
    status = rpcStatus(await receiptStatus(chain, hash)); from = tx.from.toLowerCase(); to = tx.to?.toLowerCase();
    valueEth = weiHexToNumber(tx.value); hasCalldata = !!tx.input && tx.input !== '0x';
  }

  const token = lookup?.token;
  const recipient = token?.to ?? to;
  // Wallet or contract? The RPC knows for sure. Without it: a plain call with calldata means `to` is a contract.
  let recipientContract: boolean | null = recipient ? await isContract(chain, recipient) : null;
  if (recipientContract === null && !token && hasCalldata) recipientContract = true;

  // USD value (never for testnets: no market value).
  let usd: number | null = null;
  const symbol = token?.symbol ?? (valueEth > 0 ? chain.native : null);
  const amount = token?.amount ?? valueEth;
  if (symbol && !chain.testnet && status === 'confirmed') { const price = await priceOf(ctx, symbol); if (price) usd = amount * price; }

  // Risk screen only when something already looks risky.
  let high = false;
  if (!chain.testnet && lookup && (recipientContract === true || status === 'failed' || (usd !== null && usd >= 10_000))) high = await riskHigh(ctx, hash);

  const amountText = symbol
    ? `${fmtAmount(amount)} ${symbol}${usd !== null ? ` (≈ ${fmtUsd(usd)})` : chain.testnet ? ' (testnet: no market value)' : ''}`
    : hasCalldata ? 'No ETH sent (contract call)' : `0 ${chain.native}`;
  const facts = [
    { label: 'Network', value: chain.name },
    { label: 'Status', value: STATUS_TEXT[status] + (lookup?.confirmations != null && status === 'confirmed' ? ` · ${lookup.confirmations} confirmations` : '') },
    { label: 'From', value: token?.from ?? from ?? '-' },
    { label: 'To', value: recipient ?? '-' },
    ...(token && to ? [{ label: 'Token contract', value: `${token.symbol} · ${to}` }] : []),
    { label: 'Recipient is', value: recipientContract === true ? 'A smart contract ⚠️' : recipientContract === false ? 'A normal wallet' : 'Unknown (could not check)' },
    { label: 'Amount', value: amountText },
  ];
  const v = txVerdict({ found: true, checkedAll: true, status, recipientContract, riskHigh: high, network: chain.name, boughtLine: paymentBoughtLine(ctx.labels) });
  return finish(ctx, hash, v, facts);
}

export async function checkAddress(address: string): Promise<CheckResult> {
  const ctx = await newCtx();
  const { active, unknown } = await inspectAddress(address);
  const contract = active.some((a) => a.contract);
  const mainnetEth = active.filter((a) => !a.chain.testnet && a.chain.native === 'ETH');
  const ethBalance = mainnetEth.reduce((s, a) => s + a.balance, 0);

  let usd: number | null = null;
  if (ethBalance > 0) { const price = await priceOf(ctx, 'ETH'); if (price) usd = ethBalance * price; }
  const mainnetActive = active.some((a) => !a.chain.testnet);
  const high = contract && mainnetActive ? await riskHigh(ctx, address) : false;

  const facts = [
    { label: 'Networks', value: active.length ? active.map((a) => a.chain.name).join(', ') : 'No activity found' },
    { label: 'Type', value: active.length === 0 ? 'Unknown' : contract ? 'A smart contract ⚠️' : 'A normal wallet' },
    ...active.map((a) => ({ label: a.chain.name, value: `${fmtAmount(a.balance)} ${a.chain.native}${a.chain.testnet ? ' (testnet)' : ''} · ${a.txCount} transaction${a.txCount === 1 ? '' : 's'} sent` })),
    ...(usd !== null ? [{ label: 'Balance value', value: `≈ ${fmtUsd(usd)} (Ethereum-family networks)` }] : []),
  ];
  const v = addressVerdict({ activeNetworks: active.map((a) => a.chain.name), contract, unknownChains: unknown.length, riskHigh: high, boughtLine: paymentBoughtLine(ctx.labels) });
  return finish(ctx, address, v, facts);
}
