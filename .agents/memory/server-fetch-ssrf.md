---
name: Server-side fetch of user-supplied URLs (SSRF)
description: Any api-server route that downloads a client-provided URL must allowlist the Supabase storage host.
---

# Server-side fetch must allowlist hosts (SSRF)

Any api-server route that `fetch`es a URL taken from the request body (e.g. stem
URLs in the audio export route) must validate the URL before fetching: require
`https:` and require the host to equal the project's Supabase storage host
(`new URL(process.env.SUPABASE_URL).host`). Reject everything else.

**Why:** The first version of the audio-export route fetched any `http*` URL the
authenticated client sent, which let a user point the server at internal/cloud-
metadata endpoints (SSRF). Code review blocked the task on this. Stems are always
uploaded to our own Supabase bucket, so the host is known and can be pinned.

**How to apply:** When adding a route that downloads a client-supplied URL, reuse
`isAllowedStemUrl` (in `artifacts/api-server/src/lib/audioExport.ts`) or write an
equivalent host allowlist. Also cap download size (streamed byte counter) and put
a hard timeout/kill on any spawned ffmpeg/child process to bound DoS exposure.
