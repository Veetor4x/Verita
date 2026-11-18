# Link test list
Run: `NODE_USE_ENV_PROXY=1 npx tsx backend/scripts/link-suite.mjs [runs] [urls...]` (cache bypassed, live purchases).
R1 = bought 2 signals, R2 = the agent escalated and bought 2 more miners.

## Verdict rules in force (Nov 18, evening)
- **Popular domain** (bundled top-sites list, exact site only: `google.com` / `www.google.com`, never `sites.google.com`, `google.com.evil.xyz`, `foo.github.io`): 🟢 unless 2+ sources flag it. No Round 2 if nobody flagged it ($0.02).
- **One vote per miner**: the same miner answering twice (scan + threat feed) counts as ONE source.
- **Round 1** (2 independent answers): both flag 🔴, one flags 🟡, none 🟢.
- **Round 2** (3+ independent answers): majority vote across all sources. More than half flag 🔴, nobody flags 🟢, anything in between (ties included) 🟡.
- **Unknown is not safe**: fewer than 2 independent usable answers and nobody flagged → 🟡 (miners answer `safe: null` for domains they cannot resolve).
- **Round 2 miners** are picked by Telegraph's leaderboard rank (`/leaderboard/miners`), not by the order of `/intents/{X}` (that order is shuffled on every call), so the same inputs buy the same miners.

- **Brand impersonation** (`src/engine/brands.ts`): a host containing a known brand (metamask, binance, paypal/paypa1, uniswap, coinbase, opay, ~30 more) that is not one of its official domains counts as ONE flag, reason "Pretends to be <Brand>, but isn't the official site (<domain>)". Alone → 🟡. Plus any miner flag → 🔴 (majority). Official domains and their subdomains are never flagged.

## Results

### Baseline, old rules (earlier today, from the previous version of this doc)
wicar 🔴 stable (8/8) · metamask-wallet-verify, uniswap-claim-reward, binance-airdrop-claim, paypa1-secure-login: all escalated to R2 and flipped 🔴/🟡 · github.com, wikipedia.org 🟢 stable · **google.com flipped 🟡/🟢**.

### Run A, popular list + majority vote only (3 runs each, ~$0.57)
| URL | Runs |
|---|---|
| malware.wicar.org/data/ms14_064_ole_notxp.html | 🔴R1 🔴R1 🔴R1 |
| metamask-wallet-verify.xyz/connect | 🟡R2 🔴R2 🔴R2 (flips) |
| uniswap-claim-reward.xyz | 🟢R1 🟢R1 🟢R1 (false 🟢: one miner, 302, answered both intents and counted as 2 sources) |
| binance-airdrop-claim.top | 🟡R2 🟡R2 🔴R2 (flips) |
| paypa1-secure-login.verify-account.xyz/signin | 🟡R2 🔴R2 🟡R2 (flips) |
| google.com, github.com, wikipedia.org | 🟢R1 ×3 each |

Why it still flipped: Round 2 miners were effectively random (the miner list in `/intents/{X}` is reshuffled on every call), and miner 302 was counted twice.

### Run B, + rank-based Round 2 + one vote per miner (3 runs each, ~$0.89)
| URL | Runs |
|---|---|
| malware.wicar.org/data/ms14_064_ole_notxp.html | 🔴R1 🔴R1 🔴R1 stable |
| metamask-wallet-verify.xyz/connect | 🟡R2 🟡R2 🟡R2 stable |
| uniswap-claim-reward.xyz | 🟢R2 🟢R2 🟢R2 stable (but 🟢 on a single lone "ok", see Run C) |
| binance-airdrop-claim.top | 🟡R2 🟡R2 🟡R2 stable |
| paypa1-secure-login.verify-account.xyz/signin | 🟡R2 🟡R2 🟢R2 (one flip: a lone "ok" answer, see Run C) |
| google.com, github.com, wikipedia.org | 🟢R2 ×3 each (stable, but escalated needlessly, $0.04) |

### Run C, final rules: + "unknown is not safe" + no Round 2 for unflagged popular sites (1 run each, ~$0.12; the daily budget was nearly used up)
| URL | Result |
|---|---|
| paypa1-secure-login.verify-account.xyz/signin | 🟡R2 |
| uniswap-claim-reward.xyz | 🟡R2 (was a false 🟢) |
| google.com | 🟢R1, $0.02 |
| github.com | 🟢R1, $0.02 |

Net effect: known-good sites are 🟢 in every run since the popular list (google.com no longer flips). Unstable scam-looking links: 4 of 5 in the baseline and Run A → 1 of 5 in Run B → the last flip (a lone "ok" answer turning 🟢) is closed by the "unknown is not safe" rule, but Run C is a single run per link, so treat it as a spot check, not proof of stability.

### Run D, + brand-impersonation signal (3 runs each for scam-style links, 1 run for the rest; ~$0.56)
| URL | Runs |
|---|---|
| metamask-wallet-verify.xyz/connect | 🔴R2 🔴R2 🔴R2 stable |
| binance-airdrop-claim.top | 🔴R2 🔴R2 🔴R2 stable |
| paypa1-secure-login.verify-account.xyz/signin | 🔴R2 🔴R2 🔴R2 stable |
| uniswap-claim-reward.xyz | 🟡R2 🟡R2 🟡R2 stable (brand flag only: no miner flags this link, so it stays 🟡) |
| malware.wicar.org/... | 🔴R1 |
| google.com, github.com | 🟢R1 each |
| paypal.com (the real one) | 🟢R1 (official domain, no flag) |

Net: all four scam-style links are now stable; three reach 🔴 with the specific "Pretends to be ..." reason first. The 🔴 for those three depends on at least one miner flagging them (miner 4433 and others do for these names); if no miner flags a pretender link it stays 🟡 by design.

## Demo links
- **Reliable 🔴, no escalation, ~$0.02:** `http://malware.wicar.org/data/ms14_064_ole_notxp.html` (8/8 earlier, then 3/3 in both Run A and Run B).
- **Visible escalation to 🔴 (Round 2, ~$0.04):** `http://metamask-wallet-verify.xyz/connect`, `http://binance-airdrop-claim.top/`, `http://paypa1-secure-login.verify-account.xyz/signin` → stable 🔴R2 with "Pretends to be ..." as reason 1.
  Caveat: these made-up domains are not in any threat feed; the 🔴 comes from the brand check plus one miner. A real live phishing URL (OpenPhish/PhishTank) is still worth testing once on demo day.

## Weak spots (miners do NOT flag these)
- Google Safe Browsing test pages (`testsafebrowsing.appspot.com/s/*`): 🟡 or 🟢. Don't use for the demo. (Not re-run in B/C.)
- `secure.eicar.org/eicar.com`: 🟢.
- Miner 302 (ChainSight, rank 1 on the leaderboard) answers "ok" for almost every scam link, including obvious phishing. It dilutes majorities; with one vote per miner it can no longer fake agreement, but watch it.

## Notes
- Routed Round 1 miners still differ per call (Telegraph routes). Round 2 is now repeatable for the same Round 1 set.
- Telegraph devnode had a short outage (502/521) during earlier testing. Failed purchases give an honest "no usable answer" and are never cached.
- Daily cap is $3.00 in the DB (`purchases` table, UTC day). Suite runs count against it, so the live bot shares that budget.
