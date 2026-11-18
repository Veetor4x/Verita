// Central config. Reads env vars once. Never log secrets.
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && !isNaN(Number(v)) ? Number(v) : d);

export const config = {
  telegraphBaseUrl: (process.env.TELEGRAPH_BASE_URL || 'https://devnode.telegraphprotocol.com').replace(/\/$/, ''),
  databaseUrl: process.env.DATABASE_URL || '',
  evmPrivateKey: process.env.EVM_PRIVATE_KEY || '',
  maxSpendPerCheckUsd: num(process.env.MAX_SPEND_PER_CHECK_USD, 0.1),
  maxSpendPerDayUsd: num(process.env.MAX_SPEND_PER_DAY_USD, 3.0),
  cacheTtlHours: num(process.env.CACHE_TTL_HOURS, 24),
  port: num(process.env.PORT, 3000),
  // auto = escrow first, x402 fallback. Or force 'escrow' / 'x402'.
  paymentMode: (['escrow', 'x402'].includes(process.env.PAYMENT_MODE || '') ? process.env.PAYMENT_MODE : 'auto') as 'auto' | 'escrow' | 'x402',
  network: 'eip155:11155111' as `${string}:${string}`,
  usdc: '0xcc194e1a843B658526D0D5C431f670028582Ae17',
};
