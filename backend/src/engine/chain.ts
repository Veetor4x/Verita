// Free public-RPC reads (PublicNode) used to find WHICH network a tx / address lives on and whether an address is a
// contract. Any network error means "unknown", never "not found": callers must treat the two differently.

export type ChainInfo = {
  key: string; name: string; rpc: string; native: string; testnet: boolean;
  /** Name Telegraph's lookup intent uses for this chain. Undefined = Telegraph has no miners for it. */
  telegraph?: string;
};

export const CHAINS: ChainInfo[] = [
  { key: 'eth', name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com', native: 'ETH', testnet: false, telegraph: 'eth' },
  { key: 'base', name: 'Base', rpc: 'https://base-rpc.publicnode.com', native: 'ETH', testnet: false, telegraph: 'base' },
  { key: 'arbitrum', name: 'Arbitrum One', rpc: 'https://arbitrum-one-rpc.publicnode.com', native: 'ETH', testnet: false, telegraph: 'arbitrum' },
  { key: 'optimism', name: 'Optimism', rpc: 'https://optimism-rpc.publicnode.com', native: 'ETH', testnet: false, telegraph: 'optimism' },
  { key: 'polygon', name: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com', native: 'POL', testnet: false, telegraph: 'polygon' },
  { key: 'sepolia', name: 'Ethereum Sepolia (testnet)', rpc: 'https://ethereum-sepolia-rpc.publicnode.com', native: 'ETH', testnet: true },
  { key: 'base-sepolia', name: 'Base Sepolia (testnet)', rpc: 'https://base-sepolia-rpc.publicnode.com', native: 'ETH', testnet: true },
];

export type RpcResult = { ok: true; result: any } | { ok: false };

export async function rpc(chain: ChainInfo, method: string, params: unknown[], timeoutMs = 5000): Promise<RpcResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(chain.rpc, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) return { ok: false };
    const j: any = await res.json();
    return j && 'result' in j && !j.error ? { ok: true, result: j.result } : { ok: false };
  } catch { return { ok: false }; } finally { clearTimeout(timer); }
}

export type RpcTx = { hash: string; from: string; to: string | null; value: string; input: string };

export type TxSearch = {
  found?: { chain: ChainInfo; tx: RpcTx };
  /** Chains whose RPC did not answer: the tx may live there. */
  unknown: ChainInfo[];
  /** Chains that answered "no such transaction". */
  notFound: ChainInfo[];
};

/** Ask every chain at once (free). Mainnets win ties. */
export async function findTx(hash: string): Promise<TxSearch> {
  const rs = await Promise.all(CHAINS.map(async (chain) => ({ chain, r: await rpc(chain, 'eth_getTransactionByHash', [hash]) })));
  const out: TxSearch = { unknown: [], notFound: [] };
  for (const { chain, r } of rs) {
    if (!r.ok) out.unknown.push(chain);
    else if (r.result) out.found ??= { chain, tx: r.result as RpcTx };
    else out.notFound.push(chain);
  }
  return out;
}

/** 'success' | 'failed' | 'pending' (no receipt yet) | null (RPC did not answer) */
export async function receiptStatus(chain: ChainInfo, hash: string): Promise<'success' | 'failed' | 'pending' | null> {
  const r = await rpc(chain, 'eth_getTransactionReceipt', [hash]);
  if (!r.ok) return null;
  if (!r.result) return 'pending';
  return r.result.status === '0x1' ? 'success' : 'failed';
}

/** true = contract, false = plain wallet, null = could not tell. */
export async function isContract(chain: ChainInfo, address: string): Promise<boolean | null> {
  const r = await rpc(chain, 'eth_getCode', [address, 'latest']);
  if (!r.ok) return null;
  return typeof r.result === 'string' && r.result !== '0x' && r.result !== '0x0';
}

export const weiHexToNumber = (hex: string | null | undefined): number => (hex ? Number(BigInt(hex)) / 1e18 : 0);

export type AddressFacts = { chain: ChainInfo; contract: boolean; balance: number; txCount: number };

/** Look at an address on every chain at once. `unknown` = chains that did not answer. */
export async function inspectAddress(address: string): Promise<{ active: AddressFacts[]; unknown: ChainInfo[] }> {
  const rs = await Promise.all(CHAINS.map(async (chain) => {
    const [code, bal, nonce] = await Promise.all([
      rpc(chain, 'eth_getCode', [address, 'latest']), rpc(chain, 'eth_getBalance', [address, 'latest']), rpc(chain, 'eth_getTransactionCount', [address, 'latest']),
    ]);
    return { chain, code, bal, nonce };
  }));
  const active: AddressFacts[] = []; const unknown: ChainInfo[] = [];
  for (const { chain, code, bal, nonce } of rs) {
    if (!code.ok || !bal.ok || !nonce.ok) { unknown.push(chain); continue; }
    const contract = typeof code.result === 'string' && code.result !== '0x' && code.result !== '0x0';
    const balance = weiHexToNumber(bal.result); const txCount = Number(BigInt(nonce.result || '0x0'));
    if (contract || balance > 0 || txCount > 0) active.push({ chain, contract, balance, txCount });
  }
  return { active, unknown };
}
