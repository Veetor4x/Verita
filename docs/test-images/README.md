# Test images for the image check

Used by `backend/scripts/image-suite.mjs` and recorded in `docs/IMAGE_TESTS.md`.

| File | What it is |
|---|---|
| `fake-bank-alert.png` | **Synthetic** SMS-style "bank alert" with a fake link. Rendered by us; contains no real brand artwork. It says "Synthetic test image" in the footer. |
| `scam-giveaway.png` | **Synthetic** giveaway-scam post with a fake link and an EVM address (our own burner testnet wallet). Footer: "Synthetic test image". |
| `real-photo.jpg` | A small, real photograph (two people on a conference stage). It is `video-001.jpeg` from the Go project's `src/image/testdata` (BSD-3-Clause, Copyright The Go Authors). Used only to check that a plain photo is not read as text and not flagged. |

Do not reuse the two synthetic images outside testing.
