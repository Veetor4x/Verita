# Verità — Tasks

## HANDOFF (read first) — end of session 1, Nov 18

**Done**
- PR #1 merged (rename, CLAUDE.md, README, TASKS). Everything below is on branch `claude/elegant-cray-796us8`, not yet merged.
- `backend/` skeleton (`verita-backend`), `shared/types.ts`, `.env.example`, config.
- `scripts/setup-wallet.mjs` (prints address + balances, mints test USDC, never prints the key).
- Telegraph client `src/telegraph/client.ts`: **escrow first, x402 per-call fallback** (`PAYMENT_MODE=auto|escrow|x402`). Tested live on escrow: 200, `signal_hash` + `receipt_hash` decoded.
- `discovery.ts`, `receipts.ts`, Neon layer (`src/db`, `schema.sql`), link engine (`extract`, `planner` with Round 1 → Round 2, `verdict` + 9 passing unit tests), `scripts/check-link.mjs`, `scripts/test-purchase.mjs`.
- Wallet funded: 0.25 USDC deposited in Telegraph escrow (about 23 calls left at $0.01), about 9.75 USDC in wallet, about 0.055 Sepolia ETH. See `docs/RECEIPTS.md`.

**Next (in order)**
1. New session so `DATABASE_URL` is picked up (it was a placeholder). Test Neon: `NODE_USE_ENV_PROXY=1 npx tsx scripts/_dbcheck.mjs` (recreate it if missing: `migrate()` then list tables).
2. `NODE_USE_ENV_PROXY=1 npx tsx scripts/test-purchase.mjs` → saves the first receipt to Neon; copy the hashes into `docs/RECEIPTS.md`.
3. `NODE_USE_ENV_PROXY=1 npx tsx scripts/check-link.mjs <known-bad link>` → check that the answer fields parse (`toSignal` in `verdict.ts` is untested on real THREAT_INTELLIGENCE_INDICATOR answers) and that Round 2 triggers. Tune the intent params (`indicator`) after reading the intent's `request.params` from `/engine/v1/intents/THREAT_INTELLIGENCE_INDICATOR`.
4. Open PR, merge it. Then Nov 19: Telegram bot (DM + group guard), Express server, deploy to Render.
5. Top up escrow when low: `NODE_USE_ENV_PROXY=1 node --disable-warning=ExperimentalWarning backend/scripts/deposit-escrow.mjs 1` (approves, then calls `depositUSDC`).

**Gotchas**
- **`NODE_USE_ENV_PROXY=1`** is required for any Node network call in this container (Node 22 ignores `HTTPS_PROXY` otherwise). Add `--disable-warning=ExperimentalWarning` to hide the noise.
- **RPC:** only `https://ethereum-sepolia-rpc.publicnode.com` is reachable here (viem's default and most others are blocked with 403).
- **Escrow header format:** resend the 402'd request with `X-PAYMENT` = base64 of `{x402Version:2, scheme:"escrow", network, payload:{signature, authorization:{from,to,value,validAfter,validBefore,nonce}}}`. The signature is a `personal_sign` of `extra.message` from the challenge with `{from}` **lowercased**, `{nonce}`, `{validAfter}`, `{validBefore}` filled in. Window must be 2 minutes at most. Reference: `telegraphprotocol/telegraph-mcp` `src/pay.ts`.
- **Receipts on escrow:** `receipt_hash` is in the `X-PAYMENT-RESPONSE` header (base64 JSON), `signal_hash` is in the body. There is **no `X-TELEGRAPH-RECEIPT`** header. The receipt's `miner` can differ from the body's `miner_id`; we store the body's. Escrow settles per 3-hour epoch on Telegraph's ledger, so there is no per-call Sepolia tx. Ask the organisers whether that counts as "on-chain".
- **Escrow balance:** `GET /v1/ledger/account/{wallet}` (no `/engine` prefix). If escrow reports "insufficient", the client skips escrow for 5 min and falls back to x402.
- **x402** signing works, but `facilitator.x402.rs` timed out on every settle today (Telegraph-side). Fallback may not work until it recovers.
- **x402 client API:** `new x402Client({...})` takes a selector, not a config; use `x402Client.fromConfig({schemes: [], spendControls})`. Test USDC is not a "default asset", so it needs an `allowedAssets` entry.
- **TypeScript 7:** `tsconfig` needs `"types": ["node"]`. tsx scripts need top-level await in `.mjs` files (not `-e`).
- **Intent names:** `/intents/{X}` returns 200 for wrong names; check `miner_count`. Request body to `/ask` is `{intent, params}` (or `{query}`); routed answers return `miner_id`, `result`, `field_status`, `signal_hash`, `cost_usd`.
- **Scratch scripts** `backend/scripts/_*.mjs` are git-ignored (`_dbcheck`, `_escrow`, `_chain`, `_askcheck`). Never print or log `EVM_PRIVATE_KEY`.

---
Status: ⬜ todo · 🔄 in progress · ✅ done · ❌ cut
Plan source: CLAUDE.md section 11. Update this file whenever a task changes status.
Rule: if link check + bot aren't working by Nov 20, drop all NICE items and the payment check becomes NICE.

## Nov 18 — Rename + first paid call + link engine
- ✅ Rename project to Verità (CLAUDE.md, README, docs)
- ✅ Project skeleton: `backend/` (package `verita-backend`), tsconfig, `.env.example`, `shared/types.ts`
- ✅ Wallet setup script (`scripts/setup-wallet.mjs`, burner testnet wallet)
- ✅ Telegraph client: discovery (intents, miners, prices) + paid `/ask` via escrow, x402 fallback, spend controls
- 🔄 First real paid call: done on escrow (see docs/RECEIPTS.md); saving to Neon pending new session (`scripts/test-purchase.mjs`) + receipt saved in Neon
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
