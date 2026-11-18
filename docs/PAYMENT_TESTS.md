# Payment check tests (basic)

Run: `NODE_USE_ENV_PROXY=1 npx tsx backend/scripts/payment-suite.mjs 0x<tx hash or address> [...]` (cache bypassed, live purchases).

## How it works
- **Detect:** `0x` + 64 hex = transaction hash, `0x` + 40 hex = address. In a DM they are checked automatically; in a group only via `/check` (reply to the message).
- **Which network?** Free public-RPC reads (PublicNode) ask Ethereum, Base, Arbitrum, Optimism, Polygon, Sepolia and Base Sepolia at once. If a network's RPC does not answer, we do **not** treat that as "not found": the networks Telegraph supports are probed through Telegraph, one at a time.
- **Paid (Telegraph, via escrow):** `ONCHAIN_TX_LOOKUP_GENERAL` (status, from, to, amount; prefers a miner that decodes token transfers, found by capability not by name), `CRYPTO_PRICE_USD` (USD value, best-ranked miner, falls back to the next), `TRANSACTION_RISK_GENERAL` (only when risky: recipient is a contract, tx failed, or amount ≥ $10,000).
- **Testnets:** Telegraph has no lookup miners for testnets, so Sepolia is read straight from the RPC and nothing is bought ($0, "no market value").
- **Verdict:** 🟡 if the recipient is a smart contract, the tx failed or is pending, or it was not found. 🔴 if it is a contract AND the risk screen says high. 🟢 for a confirmed payment to a normal wallet. Unknown recipient type is **not** a warning, but the reason says "could not tell".
- Reasons end with an honest line: `N checks bought: transaction lookup ×2, price.`

## Results (Nov 18)
| # | Input | Result | Cost |
|---|---|---|---|
| 1 | **Our own Sepolia escrow deposit tx** `0xd2532682c31e8060a310e38fc6aaad7af50404801e760ae6983fb343bac0ca57` | 🟡 Ethereum Sepolia (testnet), Confirmed ✅, from our burner wallet → `0x72a7…aa08b`, **recipient is a smart contract ⚠️** (the Telegraph diamond), "No ETH sent (contract call)" | $0 |
| 2 | Sepolia address: our burner wallet `0xd7a193Ae…9E68` | 🟢 normal wallet, 0.055 ETH (testnet), 8 transactions sent | $0 |
| 3 | Sepolia address: the Telegraph diamond `0x72a70e94…aa08b` | 🟡 smart contract ⚠️, 0.2 ETH (testnet) | $0 |
| 4 | **Mainnet USDT transfer** `0x3cdb78fd28dd818281b08abd4f9c42aaf7de9624fbb37d95bdb3151e7cca2ac6` | 🟢 Ethereum, Confirmed ✅ (90 confirmations), `0x98b1…2519` → `0x5d8f…684a`, **12.856392 USDT (≈ $12.84)**, token contract USDT `0xdac1…1ec7`. Recipient type: unknown (see limits). | $0.02 (lookup via miner 9002, price via miner 4283) |
| 5 | Mainnet address-poisoning transfer `0x8c9b06492b1f89b15ca335879122c27ec786b850694bd66a5fb63fb2bfe80a14` (sender tagged "Phish / Hack" on Blockscout) | 🟢 Confirmed, 209 USDT (≈ $208.70). **Missed:** we cannot see the scam tag. | $0.02 |
| 6 | Made-up hash `0x1111…1111` | 🟡 "We could not find this transaction, and some networks did not answer, so it may still exist." | $0.04 (4 probes through Telegraph, because mainnet RPCs are blocked in this sandbox) |

## Known limits (read before the demo)
- **Mainnet RPC is blocked in this build sandbox** (only the Sepolia RPC is reachable). So tests 4-6 ran in the Telegraph-only fallback: the network and amount come from Telegraph, but "wallet or contract?" for a **token** recipient could not be checked (shown as "Unknown", no warning). On Render the RPC should work and this check will then run, **but I have not seen it run live on mainnet.** Mainnet **address** checks need the RPC too, so they could not be tested here at all (the Sepolia ones are tested).
- **Scam tags are invisible to us.** The risk miners rated the poisoning wallet LOW ("nothing was flagged"). A confirmed payment from a known scammer still gets 🟢. Roadmap: a threat-feed / Blockscout-tag signal, or `THREAT_*` intents.
- The **risk screen path** (`TRANSACTION_RISK_GENERAL`) is covered by unit tests but no live test triggered it (no risky mainnet case available). The top-ranked risk miner (riskwire) answers "insufficient information" for tx hashes, so the code tries the next-ranked one.
- Telegraph's lookup miners support only eth, base, arbitrum, optimism, polygon. Other chains (BNB Chain, Solana...) are not found.
- In fallback mode a **not-found** hash costs up to ~$0.05 (one probe per network). With a working RPC it is free.
- Price: stablecoins are priced too (USDT = $0.9987, so 12.856392 USDT ≈ $12.84). Testnet values are never priced.
