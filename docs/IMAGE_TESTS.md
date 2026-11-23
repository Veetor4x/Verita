# Image / screenshot tests

Run: `NODE_USE_ENV_PROXY=1 npx tsx backend/scripts/image-suite.mjs` (live purchases; test images in `docs/test-images/`, see its README).

## What it does
- **Where:** DM: any photo, or an image sent as a file (PNG / JPEG / WebP, max 5 MB, decided by the file's first bytes, not its name). Group: a photo is **never** checked on its own; reply to it with `/check` (or send a photo captioned `/check`). Group links in a photo's caption are still guarded as before.
- **Steps:**
  1. Read the text in the image **locally on our server** (OCR).
  2. Run the normal checks on what is found (a link, transaction hash, address, or, if there is none of those, the text as a claim). Max 3 items. **Worst result first**: the image summary, then each item.
  3. Buy two forensic checks on the image itself: `IMAGE_VERIFICATION_GENERAL` and `DEEPFAKE_DETECTION_GENERAL`, from the best-ranked miners that are not stubs. Reason when a trustworthy miner says so: "This image may be edited or AI-generated."
- **Video / video note / GIF:** DM gets exactly "Video checks are coming soon. Send a screenshot instead." Groups stay silent unless someone uses `/check` on the video.
- A "🔎 Reading the image…" message is sent first (a check can take up to a minute).

## Privacy and token safety
- The photo is downloaded server-side (`getFile`), kept **in memory only**, never written to disk or the database. **The text read from the image is not stored**; only the things checked from it (links, addresses, a claim) are, like any pasted input.
- **The Telegram file URL contains the bot token and is never sent to miners, logged or stored.** Errors are cleaned (`safeError`) and download failures give a plain message. Tests cover this.
- Miners get a link to a **re-hosted copy on our own server**: `/i/<192-bit random id>.png`, in memory, removed as soon as the forensic calls finish (hard limit 2 minutes), `no-store`, `noindex`, max 8 at once. Telegraph rejects any request over 16 KB, so base64 is impossible (a screenshot is ~100 KB).
- `IMAGE_FORENSICS=off` turns off the forensic purchases (then no image is ever hosted); text is still read locally.

## What Telegraph can and cannot do for images (why it is built this way)
- **`CONTENT_EXTRACTION_GENERAL` cannot read text in an image.** I sent an image URL to all 22 miners: 9 answered, **none** read the image. Typical answers: the URL echoed back; TxLens: "the URL serves image/png, not a web page; only HTML and plain text can be extracted"; zk-extract: "Unsupported binary source; a text document is required". So the text step is **local OCR** (`tesseract.js` + bundled English data, ~14 MB; it never leaves our server). This is the one step that does not go through Telegraph, and a deviation from the brief: say so in the submission.
- **Most verification miners are stubs.** Of the 15 `IMAGE_VERIFICATION` and 14 `DEEPFAKE_DETECTION` miners, most are NASA EPIC / GIBS, USGS earthquake, Crossref, Archive.org or Wayback lookups. They return junk: for one harmless stock photo, the USGS "authenticity proxy" said "Likely authentic" for verification and **"Likely manipulated"** for deepfake. Those would cause false alarms, so stubs are skipped (by description) and a verdict only counts when it has confidence ≥ 0.6 and a written summary that does not say it could not look at the image.
- **What the two real miners say** (all three test images, same answer each time):
  - `a1-preflight` (image verification): "Inconclusive, 0.25: No AI or editing marker is embedded in the file; no visual assessment could be made in time." It only checks embedded metadata.
  - `txlens` (deepfake check): "Inconclusive, 0.8: ... without visual analysis of the photo we cannot assess typical deep-fake artefacts". It cannot see pixels.

## Results (Nov 23, ~$0.18; forensic answers dumped separately, ~$0.06)
| Image | Found by OCR | Checks run | Image result |
|---|---|---|---|
| **Fake bank alert** (synthetic SMS: "account suspended, verify your BVN: http://gtbank-secure-verify.xyz/login") | the link (confidence 91%) | link check: 🟡 "Pretends to be GTBank, but isn't the official site (gtbank.com)", "No reviews found", 5 checks bought ($0.05) | 🟡 Be careful. Not 🔴: no miner flags the made-up domain, and the brand check alone is one flag |
| **Scam giveaway post** (synthetic: "send 0.5 ETH to 0x98B1… get 5 ETH back, claim at http://musk-btc-giveaway.top") | the address and the link (the link had wrapped across two lines; repaired) | address check 🟡 ("could not reach the networks", see limits); link check 🟡 "No reviews found / too few sources could check it" ($0.07) | 🟡 Be careful. The scam is obvious to a human; none of our signals prove it |
| **Real photo** (two people on a conference stage, 150 px wide) | nothing readable (confidence 35%, noise) | none | 🟡 "No text to check in this image" (nothing was invented from the photo) |

Forensics (2 purchases per image, $0.02): all three came back inconclusive, so **no "may be edited or AI-generated" reason appeared on any image**, including the two synthetic ones.

## Known limits (read before the demo)
- **The "may be edited or AI-generated" reason has never fired live.** No miner can really inspect pixels today. The code path is unit-tested, but I could not produce a live positive. Right now the two forensic purchases cost $0.02 per image for an answer that is always "inconclusive". Consider `IMAGE_FORENSICS=off`.
- **Not tested through real Telegram.** I cannot send a photo as a user from here. The download uses Telegram's standard `getFile` + file URL; it is unit-tested with fakes (size limit, failures, token never leaked), and the routing is tested with fake Telegram updates. The live `/i/<id>` re-host route is tested over real HTTP locally, but **no miner has fetched an image from the Render server yet**. First thing to try after deploy: send the bot a screenshot.
- **Mainnet addresses and transactions could not be fully checked in my sandbox** (mainnet RPCs are blocked here), so the address in the giveaway image reported "could not reach the networks". On Render the RPC should work.
- **OCR** is good on clean screenshots (85-92% confidence) and useless on photos. Handwriting, tiny text, non-English text and heavy compression were not tested. Text read from a screenshot with no link/address is sent to miners as a claim (same as pasted text), so a screenshot of a private message would leak that text to miners.
- **Memory:** OCR needs ~150-250 MB while it runs. Render's free plan has 512 MB. Images are processed one at a time and the OCR worker is released after 60 s idle, but watch for out-of-memory restarts.
- Max 5 MB, PNG / JPEG / WebP only. Max 3 things are checked per image. Cost per image: $0.02 forensics + the checks (a link ~$0.07).
