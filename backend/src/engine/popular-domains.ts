// Deterministic "popular domain" signal. A small top-sites list bundled with the code (no network call).
//
// Safety rules (so scammers can't ride on a famous name):
//  - Only the EXACT site counts: `google.com` or `www.google.com`. Never other subdomains
//    (sites.google.com, docs.google.com, foo.github.io, foo.vercel.app can host anyone's content).
//  - `google.com.evil.xyz`, `g00gle.com`, `google.com@evil.xyz` do NOT match (we compare the real hostname).
//  - Hosting / link-shortener / user-content domains are deliberately NOT in this list.
//  - Even a popular domain still becomes 🟡/🔴 when 2+ sources flag it (see linkVerdict).

const POPULAR = `
google.com youtube.com facebook.com instagram.com twitter.com x.com linkedin.com whatsapp.com telegram.org
wikipedia.org amazon.com apple.com microsoft.com netflix.com yahoo.com bing.com duckduckgo.com reddit.com
pinterest.com tiktok.com snapchat.com discord.com twitch.tv zoom.us slack.com dropbox.com
github.com gitlab.com stackoverflow.com npmjs.com python.org nodejs.org mozilla.org cloudflare.com
openai.com anthropic.com claude.ai office.com live.com outlook.com adobe.com salesforce.com oracle.com ibm.com
intel.com nvidia.com amd.com samsung.com sony.com dell.com hp.com lenovo.com cisco.com
paypal.com stripe.com visa.com mastercard.com americanexpress.com wise.com revolut.com chase.com
bankofamerica.com wellsfargo.com citi.com hsbc.com barclays.co.uk lloydsbank.com santander.com
binance.com coinbase.com kraken.com bybit.com okx.com kucoin.com gemini.com bitfinex.com crypto.com
metamask.io uniswap.org opensea.io etherscan.io ethereum.org bitcoin.org solana.com polygon.technology
coingecko.com coinmarketcap.com tradingview.com ledger.com trezor.io phantom.app trustwallet.com
ebay.com etsy.com walmart.com target.com bestbuy.com costco.com homedepot.com ikea.com nike.com adidas.com
aliexpress.com alibaba.com shopify.com booking.com airbnb.com expedia.com tripadvisor.com uber.com lyft.com
spotify.com soundcloud.com hulu.com disneyplus.com hbomax.com primevideo.com imdb.com
bbc.com bbc.co.uk cnn.com nytimes.com washingtonpost.com theguardian.com reuters.com bloomberg.com forbes.com
wsj.com apnews.com aljazeera.com cnbc.com npr.org medium.com substack.com wordpress.com blogger.com
quora.com tumblr.com flickr.com vimeo.com imgur.com giphy.com canva.com notion.so figma.com trello.com asana.com
atlassian.com zendesk.com hubspot.com mailchimp.com docusign.com
who.int cdc.gov nih.gov nasa.gov irs.gov usa.gov gov.uk un.org europa.eu worldbank.org imf.org
harvard.edu mit.edu stanford.edu ox.ac.uk cam.ac.uk coursera.org udemy.com khanacademy.org edx.org
fedex.com ups.com dhl.com usps.com
mtn.ng gtbank.com gtco.com zenithbank.com accessbankplc.com firstbanknigeria.com uba.com opay.com paystack.com flutterwave.com
nairaland.com punchng.com premiumtimesng.com
`.split(/\s+/).filter(Boolean);

const SET = new Set(POPULAR);

/** True only for the exact site (apex or www.) of a well-known domain. */
export function isPopularDomain(urlOrHost: string): boolean {
  let host = urlOrHost.trim().toLowerCase();
  try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(host) ? host : 'https://' + host).hostname; } catch { return false; }
  host = host.replace(/\.$/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  return SET.has(host);
}

export const POPULAR_COUNT = SET.size;
