import { useCallback, useEffect, useState } from "react";
import { Loader2, Coins, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

export default function AdminPage() {
  const { getAccessToken, profile, refreshProfile } = useAuth();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [amount, setAmount] = useState("500");
  const [granting, setGranting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/status", { headers: await authHeaders() });
        const data = (await res.json()) as { isAdmin?: boolean };
        if (!cancelled) setIsAdmin(res.ok && data.isAdmin === true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authHeaders]);

  async function handleGrant() {
    const n = parseInt(amount, 10);
    if (!Number.isFinite(n) || n < 1 || n > 100000) {
      setError("Enter an amount between 1 and 100000.");
      return;
    }
    setGranting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/credits/grant", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ amount: n }),
      });
      const data = (await res.json()) as { granted?: number; credits?: number; error?: string };
      if (!res.ok) throw new Error(data.error || "Grant failed.");
      setMessage(`Granted ${data.granted} credits. New balance: ${data.credits}.`);
      await refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Grant failed.");
    } finally {
      setGranting(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white px-4 py-8 max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Admin</h1>
      </div>
      <p className="text-sm text-white/50 mb-6">Owner-only controls.</p>

      {checking ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-white/40" />
        </div>
      ) : !isAdmin ? (
        <p className="text-sm text-white/40 py-8 text-center">Not authorized.</p>
      ) : (
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5">
          <div className="flex items-center gap-2 mb-1">
            <Coins className="h-4 w-4 text-primary" />
            <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
              Give myself credits
            </p>
          </div>
          <p className="text-sm text-white/60 mb-4">
            Current balance: <span className="font-bold text-white">{profile?.credits ?? "—"}</span> credits
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              max={100000}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={granting}
              className="w-36 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
            />
            <Button onClick={() => { void handleGrant(); }} disabled={granting} className="rounded-xl">
              {granting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Grant credits
            </Button>
          </div>
          {message && <p className="mt-3 text-sm text-green-400">{message}</p>}
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          <p className="mt-4 text-[11px] text-white/30">
            Grants are logged as "Admin Credit Grant" in the credit ledger.
          </p>
        </div>
      )}
    </div>
  );
}
