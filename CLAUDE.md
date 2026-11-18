# Verità — Project Brief (CLAUDE.md)

Read this file at the start of every session. It is the single source of truth for the build.
Solo builder: **Veetor4x** (owns everything: backend, web pages, bot, deploys). Newer dev: keep code simple and readable, explain briefly, no over-engineering.

## Naming rule
- Display name everywhere humans read it (README, bot messages, web pages, pitch): **Verità** (Italian for "truth").
- Anywhere "à" can't be used (repo, package names, URLs, env vars, file names, Telegram bot username): **verita** / **Verita**.
- Repo: **github.com/Veetor4x/Verita**. Telegram bot username: e.g. `@VeritaCheckBot` (ASCII only, must end in "bot").
- Old name "Konfam" must not appear anywhere in code or docs.

## 1. Pitch
**Verità: check if a link, a news claim or a crypto payment is legit before you act on it. Every verdict is bought from several ranked Telegraph miners, with on-chain receipts.**

## 2. Hackathon rules that affect the build
- Telegraph Protocol Hackathon S2, track **Apps & Agents**. Deadline **Dec 1, 23:59 UTC**. Showcase **Nov 20**.
- The app MUST make **genuinely autonomous machine-to-machine purchases** from Telegraph and use the results for a real task. Verità's agent decides by itself which intents to buy and whether to buy more (see "Escalation").
- Scoring: technical 35 (min 24), commercial 25, growth/education 20, adoption 10, integration 5, proof 5. Need ≥70 + a working purchase.
- Submission: star github.com/telegraphprotocol/bounties, 2–5 min demo video, run instructions, receipts (signal hashes / X-TELEGRAPH-RECEIPT), commercial summary.
- Pay on **Ethereum Sepolia** (`eip155:11155111`), test USDC `0xcc194e1a843B658526D0D5C431f670028582Ae17`. Testnet only.

## 3. MVP scope (solo — protect the MUST list)

### MUST (demo-critical)
1. **Telegraph client**: discovery (intents, miners, prices), paid `/ask` via x402 with spend controls, store `signal_hash` + `receipt_hash` for every purchase, verify via `GET /engine/v1/signal/{hash}`.
2. **Link check** (escalating, see below) → verdict 🟢/🟡/🔴, max 3 reasons, Official Check.
3. **Telegram bot**: DM (paste/forward text) **and group guard** (auto-check every link posted in a group).
4. **Claim check** (fact-check with sources + Official Check).
5. **Payment check (basic)**: tx hash or address → network, wallet vs contract (warn if contract), amount in USD.
6. **Web pages served by the same Express server** (no separate frontend app):
   - `/` — paste box + "Check" button + short explainer.
   - `/c/:id` — result page: verdict card + "More details" (sources, miners, cost, receipts with signal hashes). The bot's "More details" button opens this page.
   Plain server-rendered HTML + one small CSS file. Mobile-first. No React, no build step.
7. Cache (24h per normalised input), spend caps (per check + per day), receipts stored with each check.

### NICE (only after all MUSTs work end to end)
- Share text/card for warning group chats ("Verità flagged this link 🔴 …" + link to `/c/:id`).
- Lookalike-address warning (compare to addresses checked before).
- "Report scam" button.
- Public `/stats` page (checks run, USDC spent, receipts count) — good proof for judges.
- Escrow payments instead of per-call x402.

### CUT for v1 (roadmap only)
Chrome extension, separate Next.js frontend, screenshot/OCR input, address tags, history UI, WhatsApp, local languages, phone/bank checks, price compare, dashboards, fake drug check.

## 4. Tech stack
- Node 20+, TypeScript, Express, grammY (Telegram, **webhook mode**), `@neondatabase/serverless` (Postgres over HTTPS), `@x402/fetch` `@x402/evm` `viem`.
- **DB**: Postgres on **Neon** free tier.
- **Hosting**: one **Render free** web service serves the API, the web pages and the bot webhook. UptimeRobot pings `/health` every 5 min to keep it awake. Record the demo locally if Render is slow.
- **No LLM is needed for the verdict.** Verdicts are deterministic rules over miner results.

## 5. Architecture
```
Telegram (DM + groups) ──webhook──┐
Browser (/ and /c/:id) ───────────┼──► Verità server (Express on Render)
                                  │        ├─ web pages (server-rendered HTML)
                                  │        ├─ extract  → links / tx / addresses / claims in text
                                  │        ├─ planner  → choose intents, escalate if unsure
                                  │        ├─ buyer    → Telegraph /ask via x402 (Sepolia USDC)
                                  │        ├─ verdict  → rules → SAFE / CAREFUL / SCAM + 3 reasons
                                  │        └─ Postgres (Neon): checks, purchases(receipts), cache, spend
                                  ▼
                   Telegraph devnode (paid intents, receipts, signal verify)
```

### Escalation (the "autonomous agent" story — show it in the demo)
- Round 1: buy 2 cheap, high-value intents via routed `POST /engine/v1/ask` (≈ $0.02).
- If they agree with high confidence → stop. Otherwise (disagree, errors in `field_status`, low confidence) → Round 2: buy the same intent from 2 more top-ranked miners via `POST /engine/v1/ask/{minerId}` (discovered, never hardcoded).
- Hard caps: `MAX_SPEND_PER_CHECK_USD` (default 0.10) and `MAX_SPEND_PER_DAY_USD` (default 3.00). Cache hit = $0.
- Every purchase row stores: intent, minerId, cost, signal_hash, receipt_hash, field_status, round.

### Intents per check (start with these; tune after testing answer quality)
| Check | Round 1 | Round 2 / extra |
|---|---|---|
| Link | URL_SCAN_VERDICT, THREAT_INTELLIGENCE_INDICATOR | URL_SAFE_GENERAL, DNS_RECORD_LOOKUP_GENERAL (domain age) |
| Claim | FACT_CHECK_GENERAL, NEWS_SEARCH_GENERAL | WEB_SEARCH_GENERAL, CONTENT_VERIFICATION_GENERAL |
| Payment | ONCHAIN_TX_LOOKUP_GENERAL, CRYPTO_PRICE_USD | TRANSACTION_RISK_GENERAL, SANCTIONS_SCREENING_MATCH_GENERAL |
| Official Check | WEB_SEARCH_GENERAL (brand + "official") | VENDOR_VERIFY_GENERAL |

Caution: "do-everything" miners (ChainSight 302, TxLens 9002, PREFLIGHT 20260828) — test quality before trusting. `/intents/{X}` returns 200 even for wrong names: check `miner_count`. Real price = `min_price_usdc`. A 200 can still contain errors: read `field_status`.

### Verdict rules (simple, deterministic)
- 2+ sources say malicious/false/high-risk → 🔴 Likely scam
- 1 source says so, or sources disagree, or domain < 30 days old, or payment went to a contract → 🟡 Be careful
- Otherwise → 🟢 Looks safe
- Max 3 reasons, written from templates. Several items → worst first.
- Every answer ends with: **"⚠️ Always confirm on official channels before acting."**

## 6. Data types (`/shared/types.ts`)
```ts
export type Verdict = 'SAFE' | 'CAREFUL' | 'SCAM';
export type CheckKind = 'LINK' | 'CLAIM' | 'PAYMENT';
export type Receipt = { intent: string; minerId: string; costUsd: number; signalHash: string; receiptHash?: string; round: 1 | 2 };
export type CheckResult = {
  id: string; kind: CheckKind; input: string;
  verdict: Verdict; reasons: string[]; // max 3
  officialCheck: { status: 'FOUND' | 'CLOSE' | 'NOT_FOUND'; links: string[]; officialSite?: string; officialHandle?: string };
  details: { sources: string[]; miners: string[]; receipts: Receipt[]; totalCostUsd: number; cached: boolean };
  createdAt: number;
};
```
API (JSON, same server):
- `POST /api/check` `{ text?, url? }` → `{ items: { kind, input }[] }`
- `POST /api/check/run` `{ items, mode: 'all' | number }` → `CheckResult[]` (worst first)
- `GET /api/check/:id` → `CheckResult`
- `GET /health`

## 7. File structure
```
/CLAUDE.md
/README.md               (Verità: pitch, how it works, run instructions, receipts)
/.gitignore              (.env, node_modules, dist, *.log, results*.json)
/shared/types.ts
/docs/TASKS.md           (task list + status — update every session)
/backend
  package.json (name: "verita-backend")  tsconfig.json  .env.example
  scripts/setup-wallet.mjs  scripts/test-purchase.mjs
  src/index.ts                 (Express app: API + web pages + bot webhook)
  src/config.ts
  src/telegraph/client.ts  discovery.ts  receipts.ts
  src/engine/extract.ts  planner.ts  verdict.ts
  src/engine/checks/link.ts  claim.ts  payment.ts  official.ts
  src/bot/index.ts  src/bot/format.ts
  src/web/pages.ts  src/web/public/style.css
  src/db/schema.sql  src/db/index.ts
```

## 8. Environment variables (names only — values live in the Claude Code environment settings / Render, never in chat or git)
`EVM_PRIVATE_KEY` (burner testnet wallet only), `TELEGRAPH_BASE_URL` (https://devnode.telegraphprotocol.com), `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `PUBLIC_URL` (the Render URL), `MAX_SPEND_PER_CHECK_USD`, `MAX_SPEND_PER_DAY_USD`, `CACHE_TTL_HOURS`, `PORT`.

## 9. Security rules
- Testnets and a **burner wallet only**. Never ask for, paste, log or commit private keys or seed phrases. Never print `EVM_PRIVATE_KEY`.
- `.env` is git-ignored; commit `.env.example` with names only.
- Always pass `spendControls` to x402 (`maxAmountPerPayment: "100000"` = $0.10) and enforce per-check and daily caps in code.
- Rate-limit the API (e.g. 20 checks/min per IP and per Telegram user).
- Validate input sizes (text ≤ 4,000 chars, max 5 items per check). Escape all user input in HTML pages.
- Telegram webhook must check `TELEGRAM_WEBHOOK_SECRET`.
- Group guard: in BotFather run `/setprivacy` → Disable, or the bot can't see group messages.

## 10. How we work
- Work on branch `dev`; merge to `main` by PR when a milestone works. `main` always works.
- Small commits, clear messages. Update `docs/TASKS.md` when a task changes status.

## 11. Build plan (from Nov 18, solo)
| Date | Goal |
|---|---|
| Nov 18 | Rename to Verità. First real paid call + receipt saved in Neon (if not done). Link check engine with escalation + verdict. |
| Nov 19 | Telegram bot: DM + group guard (webhook). Deploy to Render. |
| **Nov 20** | **Showcase**: link posted in a group → automatic 🔴 + receipts. |
| Nov 21–23 | Claim check, payment check, Official Check, cache, spend caps. |
| Nov 24–25 | Web pages `/` and `/c/:id` (verdict card + receipts). |
| Nov 26–27 | Tune miners, make escalation visible, NICE items only if everything works. |
| Nov 28 | README + run instructions. Switch back to Claude chat for submission materials. |
| Nov 29–30 | Record demo, collect signal hashes, commercial summary. |
| Dec 1 | Submit before 23:59 UTC. Buffer only. |
Rule: if link check + bot aren't working by Nov 20, drop all NICE items and the payment check becomes NICE.

## 12. "Done" criteria for the demo
- [ ] A scam link posted in a Telegram group gets an automatic 🔴 reply within ~15s with 3 reasons and a "More details" link.
- [ ] The `/c/:id` page shows the miners used, cost, and real `signal_hash` / `receipt_hash` values that verify on Telegraph.
- [ ] At least one check visibly escalates to Round 2 (sources disagreed → agent bought more).
- [ ] A fake news claim returns 🟡/🔴 with sources and found / close / not found.
- [ ] A Sepolia tx returns network, wallet vs contract, and USD amount.
- [ ] Second check of the same link is served from cache at $0.
- [ ] Live on Render; README has run instructions.

## 13. Open risks
- **Team registration**: if the team was registered with two members, update it to solo ("one team, one identity").
- **Payout eligibility for Nigeria**: confirm with organisers.
- **Miner quality**: test each intent with known-bad and known-good inputs before relying on it.
- **Time**: solo, 13 days. Breadth is the main risk; protect the MUST list.
- **Hosting**: Render free tier sleeps → first reply after idle can take 30–60s. UptimeRobot pings; record demo locally.
