import { apiErrorMessage, plainErrorText } from "../lib/api-error";
import { useCallback, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  IMAGE_OVERSIZE_MESSAGE,
  PUBLISH_IMAGE_MAX_BYTES,
  downscaleImageFile,
  downscaledFileName,
  isImageFile,
  mediaOversizeMessage,
  needsImageDownscale,
} from "../lib/upload-prep";

/**
 * useFileUpload — uploads a user file to `POST /api/publish/upload`
 * (multipart field "file", auth required) and returns the hosted URL.
 *
 * Limits (server-enforced): images ≤ 10 MB, audio/video ≤ 80 MB.
 * Client prep (stack300 #69, see lib/upload-prep.ts): oversize images
 * are downscaled before the bytes move; a file that still can't fit is
 * rejected here with the server's own wording instead of after a full
 * wasted upload. The server still enforces its caps on arrival.
 * Returns { upload, uploading, error, clearError }.
 */
export function useFileUpload() {
  const { getAccessToken } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const upload = useCallback(
    async (file: File): Promise<string | null> => {
      setUploading(true);
      setError(null);
      try {
        // Pre-upload rejection: a non-image over the media cap gets the
        // server's answer now, not after 80+ MB of doomed transfer.
        const oversize = mediaOversizeMessage(file);
        if (oversize) throw new Error(oversize);

        let body: Blob = file;
        let name = file.name;
        if (isImageFile(file) && needsImageDownscale(file)) {
          try {
            body = await downscaleImageFile(file);
            name = downscaledFileName(file.name, body.type || file.type);
          } catch {
            // Formats canvas can't decode (e.g. HEIC in some browsers)
            // keep the pre-#69 behavior: upload the original as-is.
            body = file;
            name = file.name;
          }
          if (body.size > PUBLISH_IMAGE_MAX_BYTES) {
            throw new Error(IMAGE_OVERSIZE_MESSAGE);
          }
        }

        const token = await getAccessToken();
        const fd = new FormData();
        fd.append("file", body, name);
        const res = await fetch("/api/publish/upload", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        const data = (await res.json().catch(() => ({}))) as {
          url?: string;
          error?: string;
          message?: string;
        };
        if (!res.ok || !data.url) {
          throw new Error(apiErrorMessage(data, `Upload failed (${res.status}).`));
        }
        return data.url;
      } catch (e) {
        setError(plainErrorText(e, "Upload failed."));
        return null;
      } finally {
        setUploading(false);
      }
    },
    [getAccessToken]
  );

  return { upload, uploading, error, clearError };
}
