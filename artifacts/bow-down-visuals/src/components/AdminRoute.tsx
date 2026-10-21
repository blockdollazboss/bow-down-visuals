import { useEffect, useState, type ReactNode } from "react";
import { Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Admin-only route guard — the route-level form of the gate the Admin
 * page and Discord Bot setup use inline: ask GET /api/admin/status
 * (server-side ADMIN_EMAILS check) with the session's access token and
 * trust only `res.ok && isAdmin === true`. While the check is in flight
 * a spinner stands in; non-admins are redirected to their dashboard and
 * the wrapped page never renders (its lazy chunk never loads either).
 * Mount inside <ProtectedRoute>, which already handles the signed-out
 * case — this guard only separates admins from signed-in non-admins.
 */
export function AdminRoute({ children }: { children: ReactNode }) {
  const { getAccessToken } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/admin/status", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const status = (await res.json()) as { isAdmin?: boolean };
        if (!cancelled) setIsAdmin(res.ok && status.isAdmin === true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  if (isAdmin === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#d4af37]" />
      </div>
    );
  }

  if (!isAdmin) {
    return <Redirect to="/dashboard" />;
  }

  return <>{children}</>;
}
