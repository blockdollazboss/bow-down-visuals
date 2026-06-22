---
name: Server-side GCS uploads via Replit object storage
description: How to upload files from Express server to GCS using Replit's sidecar auth.
---

Replit object storage (GCS) is provisioned via setupObjectStorage() in code_execution.
Bucket ID stored in DEFAULT_OBJECT_STORAGE_BUCKET_ID env var.

**Server-side upload (not presigned URL flow):**
```typescript
import { objectStorageClient } from "../../lib/objectStorage";
const bucket = objectStorageClient.bucket(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!);
const gcsFile = bucket.file(`exports/${uuid}.mp4`);
await gcsFile.save(fileBuffer, { contentType: "video/mp4" });
```

**Sign a long-lived GET URL via Replit sidecar (127.0.0.1:1106):**
```typescript
const res = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ bucket_name, object_name, method: "GET", expires_at }),
});
const { signed_url } = await res.json();
```
Maximum signed URL TTL is 1 year from signing date.
objectStorage.ts TS error: cast `await response.json()` as `{ signed_url: string }`.
