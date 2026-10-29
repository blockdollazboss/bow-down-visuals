import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

/* ── Admin awareness for client-side mirrors ──────────────────────────────
   The server is the real wall: it exempts the owner's account
   (ADMIN_EMAILS) from policy caps. A few client-side pre-checks mirror
   server caps (e.g. the 80 MB clip pre-check in front of the
   disk-backed /api/upload-clip rail) — without an admin leg they
   would refuse the owner before the server ever sees the file. This
   hook asks the same /api/admin/status the Admin page and the sidebar
   use, in the same way. Until the answer lands (and on any failure)
   it reads false — member behaviour is the safe default.        */

export function useIsAdmin(): boolean {
  const { user, getAccessToken } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/admin/status", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = (await res.json()) as { isAdmin?: boolean };
        if (!cancelled) setIsAdmin(res.ok && data.isAdmin === true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken]);
  return isAdmin;
}

/** Mirrors ADMIN_UPLOAD_MAX_BYTES on the server (lib/upload-storage). */
export const ADMIN_UPLOAD_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB

/** The upload ceiling for this caller: the member cap, or the owner's
    1 GB ceiling on the disk-backed rails when signed in as admin. */
export function uploadLimitBytes(isAdmin: boolean, memberBytes: number): number {
  return isAdmin ? ADMIN_UPLOAD_MAX_BYTES : memberBytes;
}

/** Plain label for the ceiling, for "over X" copy. */
export function uploadLimitLabel(isAdmin: boolean, memberBytes: number): string {
  return isAdmin ? "1 GB" : `${Math.round(memberBytes / (1024 * 1024))} MB`;
}
