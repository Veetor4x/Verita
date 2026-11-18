# Link test list (run: `NODE_USE_ENV_PROXY=1 npx tsx backend/scripts/link-suite.mjs [runs] [urls...]`)
Each URL is checked N times with the cache bypassed. R1 = bought 2 signals, R2 = escalated (4 signals).

## Demo link (🔴 every time)
`http://malware.wicar.org/data/ms14_064_ole_notxp.html` → 🔴 in 8/8 runs, Round 1 (no escalation), ~$0.02.

## For the "visible escalation" demo
`http://metamask-wallet-verify.xyz/connect`, `https://uniswap-claim-reward.xyz/`, `http://binance-airdrop-claim.top/`
always escalate to Round 2 but the verdict flips between 🔴 and 🟡 (depends on which miners get routed).

## Known-bad (5)
| URL | Result |
|---|---|
| malware.wicar.org/... (WICAR test malware) | 🔴 stable |
| metamask-wallet-verify.xyz/connect | R2, 🔴/🟡 mixed |
| uniswap-claim-reward.xyz | R2, 🔴/🟡 mixed |
| binance-airdrop-claim.top | R2, 🔴/🟡 mixed |
| paypa1-secure-login.verify-account.xyz/signin | R2, 🔴/🟡 mixed |

## Weak spots (miners do NOT flag these)
- Google Safe Browsing test pages (`testsafebrowsing.appspot.com/s/*`): 🟡 or 🟢. Don't use for the demo.
- `secure.eicar.org/eicar.com`: 🟢.

## Known-good (3)
github.com 🟢 stable · wikipedia.org 🟢 stable · google.com flips 🟡/🟢 (one miner disagrees, escalates).

## Notes
- Verdicts are not deterministic: the routed miner differs per call. For a reliable demo use the WICAR link.
- Telegraph devnode had a short outage (502/521) during testing. Failed purchases now give an honest "no usable answer" and are never cached.
