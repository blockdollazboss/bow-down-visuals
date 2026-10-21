import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";

/* R2 object storage client — S3-compatible API for Cloudflare R2.
   Replaces Supabase Storage for user uploads to eliminate egress fees. */

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "";
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID ?? "";
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY ?? "";
const R2_BUCKET = process.env.R2_BUCKET_NAME ?? "bow-down-visuals-media";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL ?? "";

let client: S3Client | null = null;

export function getR2Client(): S3Client {
  if (client) return client;
  if (!R2_ACCESS_KEY || !R2_SECRET_KEY) {
    throw new Error("R2 credentials not configured (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)");
  }
  client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY,
      secretAccessKey: R2_SECRET_KEY,
    },
  });
  return client;
}

export function r2PublicUrl(key: string): string {
  if (R2_PUBLIC_URL) {
    return `${R2_PUBLIC_URL.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
  }
  // Fallback to S3-style URL (requires public bucket)
  return `https://${R2_BUCKET}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
}

export async function r2Upload(key: string, body: Buffer | Uint8Array | Readable | string, contentType?: string): Promise<string> {
  const s3 = getR2Client();
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body as any,
    ContentType: contentType,
  });
  await s3.send(command);
  return r2PublicUrl(key);
}

export async function r2Delete(key: string): Promise<void> {
  const s3 = getR2Client();
  await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

export async function r2Download(key: string): Promise<Buffer> {
  const s3 = getR2Client();
  const res = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  const body = res.Body as any;
  if (!body) throw new Error(`R2 object not found: ${key}`);
  // Body can be a stream, Buffer, or Uint8Array depending on runtime
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function r2GetPresignedPutUrl(key: string, contentType: string, expiresIn = 900): Promise<string> {
  const s3 = getR2Client();
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

export async function r2GetSignedUrl(key: string, expiresIn = 3600): Promise<string> {
  const s3 = getR2Client();
  const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn });
}

/** True when the key exists in R2. Used to decide whether a legacy
 *  `supabase://` ref has been migrated before presigning (presigning itself
 *  never 404s, so this check prevents minting URLs for missing objects). */
export async function r2KeyExists(key: string): Promise<boolean> {
  const s3 = getR2Client();
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function r2List(prefix: string): Promise<string[]> {
  const s3 = getR2Client();
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = res.NextContinuationToken;
  } while (token);
  return keys;
}

export function isR2Configured(): boolean {
  return !!(R2_ACCESS_KEY && R2_SECRET_KEY && R2_ACCOUNT_ID);
}
