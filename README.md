# Verità

> *Verità* is Italian for "truth".

**Check if a link, a news claim or a crypto payment is legit before you act on it. Every verdict is bought from several ranked [Telegraph](https://telegraphprotocol.com) miners, with on-chain receipts.**

Built solo by [Veetor4x](https://github.com/Veetor4x) for the Telegraph Protocol Hackathon S2 (track: Apps & Agents).

## What it does

Paste or forward something suspicious to the Verità Telegram bot (or drop the bot in a group and it checks every link posted). You get a verdict in seconds:

- 🟢 **Looks safe**
- 🟡 **Be careful**
- 🔴 **Likely scam**

…with up to 3 plain-language reasons, an "Official Check" (is there an official site or handle?), and a "More details" page showing exactly which miners were paid, what it cost, and the receipts.

Three kinds of checks:

| Check | Input | Output |
|---|---|---|
| Link | URL | Scam/phishing verdict, domain age, official site |
| Claim | News or viral message | Fact-check with sources |
| Payment | Tx hash or address | Network, wallet vs contract, amount in USD |

## How it works

Verità is an autonomous buyer. No LLM decides the verdict; the agent buys evidence from Telegraph and applies simple, deterministic rules.

1. **Extract** links, transactions, addresses and claims from the text.
2. **Round 1:** the agent buys 2 cheap, high-value intents (for a link: URL scan verdict + threat intelligence) through Telegraph's routed `/ask` using x402 payments on Ethereum Sepolia (test USDC).
3. **Escalate:** if the answers agree with high confidence, stop. If they disagree, error out or are unsure, the agent decides on its own to **buy Round 2** from 2 more top-ranked miners.
4. **Verdict:** 2+ sources flag it → 🔴. One source, disagreement, a very new domain or a contract payment → 🟡. Otherwise 🟢.
5. **Receipts:** every purchase stores its `signal_hash` and `receipt_hash`, verifiable at Telegraph (`GET /engine/v1/signal/{hash}`).

Safety: hard spend caps per check and per day, 24h cache (a repeat check costs $0), testnet burner wallet only.

```
Telegram (DM + groups) ──webhook──┐
Browser (/ and /c/:id) ───────────┼──► Verità server (Express)
                                  │        extract → planner → buyer → verdict
                                  │        Postgres (Neon): checks, receipts, cache, spend
                                  ▼
                   Telegraph devnode (paid intents, receipts)
```

## Tech stack

Node 20+, TypeScript, Express, grammY (webhook), Neon Postgres, x402 (`@x402/fetch`, `@x402/evm`, `viem`). Hosted on Render.

## Run instructions

> 🚧 Placeholder — filled in on Nov 28 once the backend is built. See [docs/TASKS.md](docs/TASKS.md) for status.

Planned outline:

1. Clone: `git clone https://github.com/Veetor4x/Verita && cd Verita/backend`
2. `npm install`
3. Copy `.env.example` to `.env` and set the variables (burner testnet wallet only).
4. Fund the burner wallet with Sepolia ETH and test USDC (`0xcc194e1a843B658526D0D5C431f670028582Ae17`).
5. `npm run dev`, then set the Telegram webhook to `PUBLIC_URL`.

## Receipts

> 🚧 To be filled in with real `signal_hash` / `receipt_hash` values from live purchases.

## Status

Work in progress. Demo deadline: Dec 1, 2026 (23:59 UTC).

## License

See [LICENSE](LICENSE).
