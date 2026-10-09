import { useCallback, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * useFileUpload — uploads a user file to `POST /api/publish/upload`
 * (multipart field "file", auth required) and returns the hosted URL.
 *
 * Limits (server-enforced): images ≤ 10 MB, audio/video ≤ 80 MB.
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
        const token = await getAccessToken();
        const fd = new FormData();
        fd.append("file", file);
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
          throw new Error(data.message || data.error || `Upload failed (${res.status}).`);
        }
        return data.url;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
        return null;
      } finally {
        setUploading(false);
      }
    },
    [getAccessToken]
  );

  return { upload, uploading, error, clearError };
}
