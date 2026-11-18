// Deterministic brand-impersonation signal (the start of the Official Check). No network call.
//
// Idea: scam sites put a famous brand in their domain name (binance-airdrop-claim.top, paypa1-secure-login.xyz).
// If the host mentions a known brand but is NOT one of that brand's official domains, we count it as ONE flag.
//
//  - official = the official domain or any subdomain of it (help.paypal.com is fine, paypal.com.evil.xyz is not).
//  - look-alike spelling is caught: paypa1 -> paypal, binanc3 -> binance, rn/vv tricks are not covered (keep it simple).
//  - "contains" brands match anywhere inside a word (binanceairdrop). "token" brands only match as a whole word
//    between dots/dashes (apple-id-verify yes, pineapple no), for short or everyday words.
//  - Only the HOST is checked, never the path (a link to github.com/paypal/x is not impersonation).
//
// Official domain lists are what we are confident about. Missing one = a false 🟡, so extend this list when you see one.

export type Brand = { name: string; keywords: string[]; mode: 'contains' | 'token'; official: string[] };

export const BRANDS: Brand[] = [
  // Crypto
  { name: 'MetaMask', keywords: ['metamask'], mode: 'contains', official: ['metamask.io', 'consensys.io', 'consensys.net'] },
  { name: 'Binance', keywords: ['binance'], mode: 'contains', official: ['binance.com', 'binance.us', 'binance.org', 'binance.me', 'binance.info'] },
  { name: 'Coinbase', keywords: ['coinbase'], mode: 'contains', official: ['coinbase.com'] },
  { name: 'Uniswap', keywords: ['uniswap'], mode: 'contains', official: ['uniswap.org', 'uniswap.com'] },
  { name: 'OpenSea', keywords: ['opensea'], mode: 'contains', official: ['opensea.io'] },
  { name: 'Kraken', keywords: ['kraken'], mode: 'token', official: ['kraken.com'] },
  { name: 'KuCoin', keywords: ['kucoin'], mode: 'contains', official: ['kucoin.com'] },
  { name: 'Bybit', keywords: ['bybit'], mode: 'contains', official: ['bybit.com'] },
  { name: 'OKX', keywords: ['okx'], mode: 'token', official: ['okx.com'] },
  { name: 'Trust Wallet', keywords: ['trustwallet'], mode: 'contains', official: ['trustwallet.com'] },
  { name: 'Phantom', keywords: ['phantom'], mode: 'token', official: ['phantom.app'] },
  { name: 'Ledger', keywords: ['ledger'], mode: 'token', official: ['ledger.com'] },
  { name: 'Trezor', keywords: ['trezor'], mode: 'contains', official: ['trezor.io'] },
  // Payments / Nigerian fintech and banks
  { name: 'PayPal', keywords: ['paypal'], mode: 'contains', official: ['paypal.com', 'paypal.me', 'paypalobjects.com', 'paypal.co.uk', 'paypal.com.au', 'paypal.de', 'paypal.fr', 'paypal.it', 'paypal.es', 'paypal.ca'] },
  { name: 'Opay', keywords: ['opay'], mode: 'token', official: ['opay.com', 'opaycheckout.com'] },
  { name: 'Paystack', keywords: ['paystack'], mode: 'contains', official: ['paystack.com', 'paystack.co'] },
  { name: 'Flutterwave', keywords: ['flutterwave'], mode: 'contains', official: ['flutterwave.com'] },
  { name: 'GTBank', keywords: ['gtbank'], mode: 'contains', official: ['gtbank.com', 'gtco.com'] },
  { name: 'Zenith Bank', keywords: ['zenithbank'], mode: 'contains', official: ['zenithbank.com'] },
  { name: 'Access Bank', keywords: ['accessbank'], mode: 'contains', official: ['accessbankplc.com', 'accessbank.com'] },
  { name: 'First Bank', keywords: ['firstbanknigeria'], mode: 'contains', official: ['firstbanknigeria.com'] },
  { name: 'UBA', keywords: ['uba'], mode: 'token', official: ['uba.com', 'ubagroup.com'] },
  { name: 'MTN', keywords: ['mtn'], mode: 'token', official: ['mtn.ng', 'mtn.com'] },
  // Big tech / services most used in phishing
  { name: 'Apple', keywords: ['apple'], mode: 'token', official: ['apple.com', 'icloud.com'] },
  { name: 'Microsoft', keywords: ['microsoft'], mode: 'contains', official: ['microsoft.com', 'live.com', 'office.com', 'outlook.com', 'microsoftonline.com'] },
  { name: 'Google', keywords: ['google'], mode: 'contains', official: ['google.com', 'google.com.ng', 'google.co.uk', 'googleapis.com', 'gstatic.com', 'youtube.com', 'goo.gl'] },
  { name: 'Amazon', keywords: ['amazon'], mode: 'token', official: ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazonaws.com', 'amazon.in'] },
  { name: 'Netflix', keywords: ['netflix'], mode: 'contains', official: ['netflix.com'] },
  { name: 'Facebook', keywords: ['facebook'], mode: 'contains', official: ['facebook.com', 'fb.com', 'meta.com'] },
  { name: 'Instagram', keywords: ['instagram'], mode: 'contains', official: ['instagram.com'] },
  { name: 'WhatsApp', keywords: ['whatsapp'], mode: 'contains', official: ['whatsapp.com', 'whatsapp.net', 'wa.me'] },
  { name: 'Telegram', keywords: ['telegram'], mode: 'token', official: ['telegram.org', 'telegram.me', 't.me', 'telegram.dog'] },
  { name: 'DHL', keywords: ['dhl'], mode: 'token', official: ['dhl.com', 'dhl.de'] },
  { name: 'FedEx', keywords: ['fedex'], mode: 'contains', official: ['fedex.com'] },
];

// paypa1 -> paypal, binanc3 -> binance, g00gle -> google. '1' can be an l or an i, so we try both.
function variants(text: string): string[] {
  const base = text.replace(/0/g, 'o').replace(/3/g, 'e').replace(/5/g, 's').replace(/4/g, 'a').replace(/\$/g, 's');
  return [...new Set([text, base.replace(/1/g, 'l'), base.replace(/1/g, 'i')])];
}

const isUnder = (host: string, domain: string) => host === domain || host.endsWith('.' + domain);

export type BrandResult =
  | { kind: 'none' }
  | { kind: 'official'; brand: string; officialDomain: string }
  | { kind: 'impersonation'; brand: string; officialDomain: string };

export function checkBrand(urlOrHost: string): BrandResult {
  let host = urlOrHost.trim().toLowerCase();
  try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(host) ? host : 'https://' + host).hostname; } catch { return { kind: 'none' }; }
  host = host.replace(/\.$/, '').replace(/^www\./, '');

  // 1. Exactly an official site (or a subdomain of one)? -> FOUND, no flag.
  for (const b of BRANDS) {
    const off = b.official.find((d) => isUnder(host, d));
    if (off) return { kind: 'official', brand: b.name, officialDomain: off };
  }
  // 2. Mentions a brand but is not official -> impersonation.
  const hostVariants = variants(host);
  for (const b of BRANDS) {
    const hit = hostVariants.some((h) => {
      if (b.mode === 'contains') return b.keywords.some((k) => h.includes(k));
      const tokens = h.split(/[.\-_]/);
      return b.keywords.some((k) => tokens.includes(k));
    });
    if (hit) return { kind: 'impersonation', brand: b.name, officialDomain: b.official[0] };
  }
  return { kind: 'none' };
}
