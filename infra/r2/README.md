# R2 bucket infra notes

Bucket: the media bucket named by `R2_BUCKET_NAME` in the API service
environment (code default `bow-down-visuals-media`, `lib/r2-client.ts`).

## Multipart lifecycle rule — stack400 C-08 (recorded 2026-11-08)

**Wanted rule (bucket lifecycle configuration):**

- Rule: abort incomplete multipart uploads after 1 day
  (`AbortIncompleteMultipartUpload` / `AbortIncompleteMultipartUpload: 1 day`).
- Purpose: parts from multipart sessions abandoned by a killed browser,
  closed tab, or dead network are never aborted by the client and would
  otherwise sit in the bucket forever, silently growing storage.

**Config status: NOT SET — blocked, with the exact blocker named.**
The rule was not applied and no read-back verification exists, because no
route available to the agent in this environment can reach R2 bucket
configuration:

- The registered Cloudflare API token is scoped to DNS for the
  bowdownvisuals.com zone only — it cannot reach R2 (see
  `custom.cloudflare` connector doc: "It cannot reach R2, Workers or any
  other zone"; "R2 object uploads still need the separate R2 access keys,
  which live in the staging Render service environment and are not
  reachable through this connector").
- The Cloudflare dashboard blocks the agent browser in this environment
  (login never completes), so the console route is an owner-hand step.
- The R2 S3 credentials (which could set the rule via
  `PutBucketLifecycleConfiguration`) exist only inside the API service's
  Render environment and are never exposed to this workspace.

**To finish this item (owner/admin hand, ~2 minutes):** Cloudflare
dashboard → R2 → the media bucket → Settings → Object lifecycle rules →
add rule "Abort incomplete multipart uploads after 1 day". Then read the
rule back on the same screen and update this note with the read-back
(date + rule as displayed). Until then this item's config half stays
OPEN — do not mark it verified.

**Code-side mitigation shipped meanwhile (same item, lane
`s400-r2-storage`):** `artifacts/api-server/src/routes/r2-upload.ts`
tracks in-flight multipart sessions per member and, at each new
multipart init, aborts tracked sessions older than 24h bucket-side via
`r2AbortMultipartUpload` before counting the caller's in-flight cap
(C-07). Honest limit: the sweep only sees sessions the current API
process started — uploads orphaned by a process restart are invisible
to it, which is exactly why the bucket rule above is still required.
A bucket-wide sweep would need a `ListMultipartUploads` export in
`lib/r2-client.ts` (reported to the parent as a proven r2-client need;
not taken by this lane).
