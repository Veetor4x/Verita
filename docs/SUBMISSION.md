# Verità — Submission pack

## 1. Form answers
- **Project:** Verità · **Track:** Apps & Agents · **Missions:** 07 Consumer Platform (primary), 14 Web3 Native & DeFi (secondary)
- **Pitch:** Check if a link, a news claim or a crypto payment is legit before you act on it. Every verdict is bought from several ranked Telegraph miners, with verifiable receipts, settled on-chain per epoch.
- **Promo video:** https://youtu.be/SAiHnsqHNUY
- **Links:** repo github.com/Veetor4x/Verita · live https://verita-znay.onrender.com · bot https://t.me/AskVeritaBot · receipts docs/RECEIPTS.md · stats /stats
- **Autonomous purchases:** the agent pays Telegraph itself (escrow rail, x402 fallback). It picks intents, buys 2 answers, and buys more from top-ranked miners if they disagree. No human approves a purchase. Caps: $0.10/check, $10/day (the live Render setting).
- **Education:** every 🔴 says in plain words why it is a scam (for example "it pretends to be MetaMask; the real site is metamask.io"), so users learn the pattern, not just the verdict.
- **Wallet type:** wallet-vs-contract is read from free public RPC nodes, not bought from Telegraph.
- **Proof:** 280+ checks, 841 receipts, 30 miners, 10 intents, $8.07 test USDC (Nov 24). Every row has signal_hash + receipt_hash; verify at `GET /engine/v1/signal/{hash}`.
- **Honest limits:** claim results depend on miner answers; scam-wallet tags often missed; image forensics is switched off (text is read locally, photos are not sent to miners), so the "edited/AI" signal is unavailable; mainnet wallet-vs-contract untested live; Render free tier slow after idle.
- **Before submitting:** star github.com/telegraphprotocol/bounties.

## 2. Demo video (target 3:30)
| Time | Shot | Say |
|---|---|---|
| 0:00 | Group chat: someone posts the WICAR link | (no intro, start on the chat) |
| 0:05 | 🔴 reply appears, with reason and buttons | "Verità's group guard just flagged it. Red, in plain words." |
| 0:10 | Logo + banner | "Verità: check before you click." |
| 0:20 | Tap Share warning | "One tap warns friends." |
| 0:35 | More details → /c/:id | "Why it is red, which miners answered, and the receipts." |
| 0:50 | Tap More details → /c/:id | "Here are the miners, the cost, and the receipts." |
| 1:20 | Send metamask-wallet-verify.xyz | "Two miners disagreed…" |
| 1:40 | Show Round 2 on /c/:id | "…so the agent decided alone to buy more answers." |
| 2:05 | google.com → 🟢; repeat link → cache $0 | "Safe links stay green. Repeats cost nothing." |
| 2:25 | "Drinking bleach cures COVID-19" → 🔴 + sources | "Claims too." |
| 2:45 | Look-alike wallet → 🔴; scam screenshot → 🔴 | "Address poisoning and screenshots." |
| 3:05 | /stats, click a signal hash → Telegraph verify | "Every purchase is verifiable." |
| 3:20 | Close | "Verità: truth, bought from many miners." |
Tips: warm Render first (open /health); record phone + browser; show real hashes.

## 3. Commercial summary
- **Problem:** scam links, fake news and wallet-poisoning hit everyday users, mostly on chat apps.
- **Customer:** families, community admins (Telegram/WhatsApp groups), crypto newcomers; later wallets, exchanges, banks.
- **Value:** instant plain-language verdict at ~$0.02–0.10 per check; no LLM hallucination (deterministic rules over paid, receipted data).
- **Revenue:** free tier + group-admin subscription; per-check pay-as-you-go; B2B API for wallets/communities.
- **Why Telegraph:** each check creates 2–6 real miner purchases, so Verità is a steady demand source for miners and a showcase of escrow receipts.
- **Unit economics (measured, testnet):** average miner answer costs $0.01 (807 purchases). A paid check averages about $0.04 (links and claims $0.04, payments $0.015, images $0.07). Repeat checks within 24h cost $0 (cache). Blended cost across paid and cached checks is about $0.02.
- **Planned pricing (a plan, not live):** pay-as-you-go $0.10 per new check (about 60% gross margin at $0.04 cost); Group Guard $5/month per group with 100 new-link checks included (worst-case cost $4, typically about $2 with cache). Free tier for individuals, capped per day.
- **Growth:** group guard (every group is a distribution channel), shareable warning cards, public /stats.
- **Roadmap:** WhatsApp, local languages, browser extension, scam-wallet tags, mainnet.

## 4. Pitches
**1 minute:** "Every day people lose money to a fake link, a fake news post or a poisoned wallet address. Verità is a Telegram bot and website that checks them first. Paste or post anything: Verità's agent buys answers from several Telegraph miners by itself, compares them, and replies 🟢, 🟡 or 🔴 in simple words. If the miners disagree, it buys more answers on its own. Rules, not an LLM, decide the verdict, so it is explainable. Every purchase has a signal hash and receipt anyone can verify: over 840 so far from 30 miners. Add it to a group and every link gets checked automatically. Verità: check before you act."

**3 minutes:** 1-minute pitch + (a) live walk-through: WICAR link in group → 🔴 → /c/:id receipts; (b) escalation: metamask-wallet-verify.xyz, two miners disagree, agent buys Round 2; (c) why it is real: escrow rail, spend caps ($0.10/check, $10/day), 24h cache, 200 tests, deterministic verdicts; (d) business: free for people, subscription for group admins, API for wallets; each check = several miner purchases; (e) honest limits and roadmap; close with the stats.

## 5. Judge Q&A
- **Is it autonomous?** Yes. The agent chooses intents, miners and whether to escalate; no human approves purchases. Caps are enforced in code.
- **Why no LLM?** Deterministic majority-vote rules are cheap, explainable and cannot hallucinate. "Unknown is not safe" → 🟡.
- **How do I verify receipts?** /stats and docs/RECEIPTS.md list signal_hash/receipt_hash; `GET /engine/v1/signal/{hash}` returns the buyer wallet.
- **Escrow vs x402?** Escrow (confirmed by Telegraph to count as purchase proof): deposit once, sign each call, settled per 3-hour epoch. x402 is the automatic fallback.
- **What if miners are wrong?** Votes are one per miner, trusted-source rule for claims, escalation on disagreement, 🟡 when unsure. Gaps are documented in docs/*_TESTS.md.
- **Spend risk?** Burner testnet wallet, per-check and daily caps, rate limits, cache.
- **Business model?** See section 3.
- **Is the stats page honest?** /stats separates real usage (Telegram users other than the owner: unique users, groups protected, checks) from testing (owner, scripts, website). They are never added together.
- **Weakest part?** Thin miner market: some claims stay 🟡, scam-wallet tags are missed, image forensics is off.
- **Privacy?** Images are read locally (OCR); not sent to miners.
- **Why Telegram?** Scams spread in chats; the group guard protects people where they are.
