import { useCallback, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/**
 * Paid AI call helper shared by every Content Intelligence step.
 * Uses the credit-confirm flow (confirm dialog → server 402 pre-check →
 * charge → auto-refund on failure handled server-side). Returns `null`
 * when the user cancels the confirmation or the call fails.
 */
export function usePaidCall() {
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const call = useCallback(
    async <T = Record<string, unknown>>(endpoint: string, body: Record<string, unknown>): Promise<T | null> => {
      if (loading) return null;
      setLoading(true);
      setError(null);
      setOutOfCredits(false);
      try {
        const res = await confirmedFetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res) return null; // user cancelled the credit confirmation
        const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
        if (res.status === 402 || data.error === "out_of_credits") {
          setOutOfCredits(true);
          refreshProfile();
          return null;
        }
        if (!res.ok) {
          throw new Error(data.message || data.error || `Request failed (${res.status}).`);
        }
        refreshProfile();
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Request failed. Try again.");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [confirmedFetch, loading, refreshProfile]
  );

  return { call, loading, error, setError, outOfCredits };
}
