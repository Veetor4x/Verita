# Verità — Receipts log

Real purchases from Telegraph (devnode), Ethereum Sepolia, test USDC only. Burner wallet: `0xd7a193Ae8a09b5BDc7E0888AFa51C20759bd9E68`.
Verify any signal: `GET https://devnode.telegraphprotocol.com/engine/v1/signal/{signal_hash}` (returns 200 and the buyer wallet).

## On-chain transactions (Sepolia)
| What | Tx hash |
|---|---|
| Mint 10 test USDC | `0x66f96a82ff360018ff110d04bf2948f905905e5a6f1825b5b0d31ceb6c5f6695` |
| Approve 0.25 USDC to the Telegraph diamond | `0xf40ce8e0b05a6ed0c67653e1120204f925fe3ee14178533e7d2f1a19c8f6b3af` |
| Escrow deposit 0.25 USDC (`depositUSDC`) on `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b` | `0xec4cd966265e585bd8700099654999862dfcd340fdb9cf0067226d8c5f3500cb` |

## Paid calls (rail: escrow)
Escrow calls are charged to our Telegraph escrow balance and settled per 3-hour epoch on Telegraph's ledger (`"chain":"telegraph"`), so there is no per-call Sepolia tx. The receipt comes in the `X-PAYMENT-RESPONSE` header; the `signal_hash` is in the response body. There is no `X-TELEGRAPH-RECEIPT` header on escrow responses.

| # | Time (UTC) | Intent | Answering miner | Cost | signal_hash | receipt_hash |
|---|---|---|---|---|---|---|
| 1 | 2026-11-18 08:10 | URL_SCAN_VERDICT (`https://example.com/`) | 731006 Counterproof URL Safety | $0.01 | `0x3073564232e0c02f453cd88ec3d1bbb7bb729bec4f207f7fbb9365d681ce2204` | `0xe70b370fd337bfca4a9af4ee28a03e6eee98c0d6cf8b1e8941a948499ea9628c` |
| 2 | 2026-11-18 (client test) | URL_SCAN_VERDICT (`https://example.com/`) | 731006 Counterproof URL Safety | $0.01 | `0x6f2c2c199a5fcca7139046e0b30096a458c273b9cdb869a2fea9fba068b47c32` | `0x9b27154382dee5897a5b17fa2c1d3564ec21bf919400ba46b377cf11b054a413` |

Call 1 receipt (decoded `X-PAYMENT-RESPONSE`): `rail: escrow`, `amount_uusdc: 10000`, `epoch_id: 8`, `settlement: epoch`, `chain: telegraph`.

Neither call is saved in Neon yet (`DATABASE_URL` was a placeholder in that session). Re-run `scripts/test-purchase.mjs` in the new session to store one.

## Ledger snapshot (call 1)
`GET /v1/ledger/account/{wallet}` → deposited 250000, balance 250000, available 240000, unbilled 10000 (uUSDC).

## x402 per-call rail
Signing and verification worked, but settlement failed ~10 times in a row with `facilitator.x402.rs/settle: context deadline exceeded` (Telegraph-side). No funds were taken. Kept as the fallback in `backend/src/telegraph/client.ts`.
