# Verità

> *Verità* is Italian for "truth".

**Check if a link, a news claim or a crypto payment is legit before you act on it. Every verdict is bought from several ranked [Telegraph](https://telegraphprotocol.com) miners, with on-chain receipts.**

Built solo by [Veetor4x](https://github.com/Veetor4x) for the Telegraph Protocol Hackathon S2 (track: Apps & Agents). Testnet only (Ethereum Sepolia, test USDC).

- **Live:** https://verita-znay.onrender.com (home page with a paste box, `/stats` with live receipts)
- **Bot:** [@AskVeritaBot](https://t.me/AskVeritaBot)
- **Proof:** [receipts](docs/RECEIPTS.md) · [/stats](https://verita-znay.onrender.com/stats)

## What it checks

| You send | You get |
|---|---|
| A **link** | 🟢 / 🟡 / 🔴, up to 3 reasons, brand look-alike check, reviews / adverse news, "Official site" button |
| A **claim** (news, viral message) | true / unverified / false, up to 3 real source links, an Official Check line |
| A **tx hash or wallet address** | network, from → to, wallet vs contract, amount and USD value, status; a warning for look-alike addresses |
| A **screenshot** (Telegram) | the text is read, then the links, addresses and claims found are checked, worst first |
| `/reviews name or site` | what reviews and adverse news say about a business or site |

In a group the bot checks every link posted. For anything else, reply to the message with `/check`. Every answer ends with "⚠️ Always confirm on official channels before acting."

## How it works

Verità is an **autonomous buyer**: no LLM decides a verdict. The agent pays Telegraph miners itself and applies simple, deterministic rules.

1. **Extract** links, transaction hashes, addresses and claims from the message (or from the text read out of an image).
2. **Round 1:** it buys 2 cheap, high-value intents (for a link: URL scan + threat intelligence) through Telegraph's routed `/ask`.
3. **Escalate:** if the answers agree, it stops. If they disagree or fail, it decides on its own to buy **Round 2** from the best-ranked miners it has not used yet (ranked by Telegraph's leaderboard, never hardcoded).
4. **Verdict:** majority vote over independent miners (one vote per miner), plus free signals (popular-domain list, brand look-alike). "Unknown is not safe": too few answers means 🟡.
5. **Receipts:** every purchase stores its `signal_hash` and `receipt_hash`. Anyone can verify a signal at `GET /engine/v1/signal/{hash}`.

**Payments** use Telegraph's **escrow** rail (deposit USDC once with `depositUSDC`, then each call is a signed message; settled per 3-hour epoch on Telegraph's ledger), with per-call **x402** as the automatic fallback. Hard caps: `MAX_SPEND_PER_CHECK_USD` and `MAX_SPEND_PER_DAY_USD`. A repeat check inside 24 hours is served from cache at $0.

### Architecture

```
Telegram (DM, groups) ──webhook──┐
Browser ( /  /check  /c/:id  /stats ) ─┼──► Verità server (one Express app on Render)
                                       │      bot/       grammY: routing, /check, /reviews, photos
                                       │      engine/    extract → planner → verdict (deterministic)
                                       │                 checks: link, claim, payment, reviews, image
                                       │      telegraph/ discovery, escrow + x402 payments, receipts
                                       │      web/       server-rendered pages, no build step
                                       │      db/        Neon Postgres: checks, purchases (receipts), cache, seen addresses
                                       ▼
                    Telegraph devnode (paid intents, receipts, signal verify) + free public RPCs
```

## Run it yourself

Needs Node 20+, a Neon Postgres database, a Telegram bot token (from @BotFather) and a **burner testnet wallet** (never a real one).

```bash
git clone https://github.com/Veetor4x/Verita && cd Verita/backend
npm install
cp .env.example .env        # fill in the values below (names only are committed)
```

| Variable | What |
|---|---|
| `EVM_PRIVATE_KEY` | burner testnet wallet key (Sepolia ETH for gas + test USDC) |
| `DATABASE_URL` | Neon connection string (tables are created on start) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | from BotFather / any random string |
| `PUBLIC_URL` | the server's public https URL (the webhook is registered there) |
| `TELEGRAPH_BASE_URL` | `https://devnode.telegraphprotocol.com` |
| `MAX_SPEND_PER_CHECK_USD`, `MAX_SPEND_PER_DAY_USD`, `CACHE_TTL_HOURS` | caps and cache (defaults 0.10 / 3.00 / 24) |
| `PAYMENT_MODE` | `auto` (escrow, x402 fallback), `escrow` or `x402` |
| `IMAGE_FORENSICS` | `off` = never send photos to forensic miners (text is still read locally) |

```bash
# 1. Fund the burner wallet: prints the address and balances, mints test USDC
NODE_USE_ENV_PROXY=1 node scripts/setup-wallet.mjs 20      # NODE_USE_ENV_PROXY only if you are behind an HTTP proxy
# 2. Put USDC into Telegraph escrow (approve + depositUSDC), top up whenever it runs low
node scripts/deposit-escrow.mjs 5
# 3. First paid call; saves the receipt and prints signal_hash / receipt_hash
npx tsx scripts/test-purchase.mjs
# 4. Run the server (home page on :3000, webhook registered when PUBLIC_URL is set)
npm run dev          # production: npx tsx src/index.ts
```

In BotFather run `/setprivacy` → **Disable**, or the bot cannot see links posted in groups.

**Tests:** `npm test` (about 200 unit tests; none spends money or uses the network). Live suites that do spend a little: `scripts/link-suite.mjs`, `claim-suite.mjs`, `payment-suite.mjs`, `review-suite.mjs`, `image-suite.mjs`.

**Deploy:** one Render web service. Build `cd backend && npm ci --include=dev`, start `cd backend && npx tsx src/index.ts`, with the variables above. UptimeRobot pinging `/health` every 5 minutes keeps the free plan awake.

## Receipts and proof

Every purchase is public and verifiable: see [docs/RECEIPTS.md](docs/RECEIPTS.md) (deposit transactions, one purchase per intent, ledger) and the live [/stats](https://verita-znay.onrender.com/stats) page (latest signal hashes, each linking to Telegraph's verify endpoint).

## Honest limits

Test records with results and gaps: [links](docs/LINK_TESTS.md) · [claims](docs/CLAIM_TESTS.md) · [payments](docs/PAYMENT_TESTS.md) · [reviews](docs/REVIEW_TESTS.md) · [images](docs/IMAGE_TESTS.md). In short: Telegraph's miner market is thin, so many claims stay 🟡, review data is scarce, no miner can read text in an image (we read it locally), and the image "edited / AI-generated" signal has never fired. Project status and history: [docs/TASKS.md](docs/TASKS.md).

## License

See [LICENSE](LICENSE).
