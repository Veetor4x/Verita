# Verità — Tasks

Status: ⬜ todo · 🔄 in progress · ✅ done · ❌ cut
Plan source: CLAUDE.md section 11. Update this file whenever a task changes status.
Rule: if link check + bot aren't working by Nov 20, drop all NICE items and the payment check becomes NICE.

## Nov 18 — Rename + first paid call + link engine
- ✅ Rename project to Verità (CLAUDE.md, README, docs)
- ✅ Project skeleton: `backend/` (package `verita-backend`), tsconfig, `.env.example`, `shared/types.ts`
- ✅ Wallet setup script (`scripts/setup-wallet.mjs`, burner testnet wallet)
- ✅ Telegraph client: discovery (intents, miners, prices) + paid `/ask` via x402 with spend controls
- 🔄 First real paid call (blocked: Telegraph facilitator settle timeouts) (`scripts/test-purchase.mjs`) + receipt saved in Neon
- ✅ Neon schema (`checks`, `purchases`, `cache`, `spend`)
- 🔄 Link check engine: planner with escalation (Round 1 → Round 2) + deterministic verdict

## Nov 19 — Bot + deploy
- ⬜ Telegram bot, DM mode (webhook, secret check)
- ⬜ Group guard (auto-check links; BotFather `/setprivacy` → Disable)
- ⬜ Deploy to Render, set webhook, UptimeRobot ping on `/health`

## Nov 20 — SHOWCASE
- ⬜ Demo: scam link posted in a group → automatic 🔴 + receipts

## Nov 21–23 — More checks
- ⬜ Claim check (fact-check + sources)
- ⬜ Payment check (tx hash/address → network, wallet vs contract, USD amount)
- ⬜ Official Check (FOUND / CLOSE / NOT_FOUND)
- ⬜ Cache (24h per normalised input) and spend caps (per check + per day)

## Nov 24–25 — Web pages
- ⬜ `/` paste box + explainer
- ⬜ `/c/:id` verdict card + "More details" (miners, cost, receipts)
- ⬜ `/api/check`, `/api/check/run`, `/api/check/:id`, rate limiting, input validation

## Nov 26–27 — Tune
- ⬜ Test each intent with known-bad / known-good inputs; tune miners
- ⬜ Make escalation visible (Round 2 shown in bot + `/c/:id`)
- ⬜ NICE (only if all MUSTs work): share card, lookalike-address warning, report scam, `/stats`, escrow

## Nov 28 — Docs
- ⬜ README run instructions + receipts
- ⬜ Switch back to Claude chat for submission materials

## Nov 29–30 — Submission prep
- ⬜ Record 2–5 min demo video
- ⬜ Collect signal hashes / receipts
- ⬜ Commercial summary
- ⬜ Star github.com/telegraphprotocol/bounties

## Dec 1 — Submit
- ⬜ Submit before 23:59 UTC (buffer only)

## Demo "done" criteria (CLAUDE.md section 12)
- ⬜ Scam link in group → 🔴 within ~15s, 3 reasons, "More details" link
- ⬜ `/c/:id` shows miners, cost, real signal/receipt hashes that verify
- ⬜ At least one visible Round 2 escalation
- ⬜ Fake news claim → 🟡/🔴 with sources + found/close/not found
- ⬜ Sepolia tx → network, wallet vs contract, USD amount
- ⬜ Repeat check served from cache at $0
- ⬜ Live on Render; README has run instructions

## Open risks / admin
- ⬜ Update hackathon team registration to solo ("one team, one identity")
- ⬜ Confirm payout eligibility for Nigeria with organisers
