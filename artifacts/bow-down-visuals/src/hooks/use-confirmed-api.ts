import { useCallback } from "react";
import { useCreditConfirm } from "@/contexts/CreditConfirmContext";
import { useAuth } from "@/contexts/AuthContext";
import { getCreditCost } from "@/lib/credit-costs";
import { toast } from "@/hooks/use-toast";

/**
 * A fetch-compatible function that may return null when the user
 * cancels the credit confirmation. Pass `confirmedFetch` from
 * useConfirmedApi() into shared lib helpers via this type.
 */
export type FetchImpl = (
  input: string,
  init?: RequestInit
) => Promise<Response | null>;

/**
 * Hook for making API calls that may cost credits.
 * Automatically shows a confirmation popup before spending.
 *
 * Usage:
 *   const { confirmedFetch } = useConfirmedApi();
 *   const res = await confirmedFetch("/api/generate-song", {
 *     method: "POST",
 *     body: JSON.stringify({...}),
 *   });
 *   // Returns null if user cancelled
 */
export function useConfirmedApi() {
  const { confirmSpend } = useCreditConfirm();
  const { getAccessToken, refreshProfile } = useAuth();

  const confirmedFetch = useCallback(
    async (
      endpoint: string,
      options?: RequestInit & { skipConfirm?: boolean; overrideCost?: number; overrideFeature?: string }
    ): Promise<Response | null> => {
      const { skipConfirm, overrideCost, overrideFeature, ...fetchOptions } = options ?? {};

      /* The call's price, resolved once: it gates the confirm popup,
         the spent toast, and the post-settle balance refresh below. */
      let paidCost = 0;
      let paidFeature = "Feature";
      if (!skipConfirm) {
        const registered = getCreditCost(endpoint);
        const cost = overrideCost ?? registered?.cost ?? 0;
        const feature = overrideFeature ?? registered?.feature ?? "Feature";
        paidCost = cost;
        paidFeature = feature;

        if (cost > 0) {
          const confirmed = await confirmSpend({ cost, feature });
          if (!confirmed) return null;
        }
      }
      const paidCall = paidCost > 0;

      /* Balance-display freshness (Nov 11 $0 probe): the displayed
         balance is AuthContext profile state, refetched only at
         bootstrap and on auth changes — so a ledger charge that
         posted at 12:40 did not move the on-screen balance until
         something unrelated refetched at 13:19. Every confirmed PAID
         call now refreshes the profile when it settles — success,
         failure response, or network throw alike (a failed generation
         can still have charged, and its refund lands in the same
         window). Fire-and-forget and failure-proof: a broken refresh
         never touches the caller's response. Free and skipConfirm
         calls never trigger it. */
      const refreshBalanceAfterSettle = () => {
        if (!paidCall) return;
        try {
          void refreshProfile().catch(() => {});
        } catch {
          /* a failed refresh never breaks the caller's response */
        }
      };

      /* Attach the Supabase access token automatically so every authed
         endpoint gets its Bearer header without each page wiring it up.
         Skipped when the caller already set Authorization explicitly. */
      const headers = new Headers(fetchOptions.headers);
      if (!headers.has("Authorization")) {
        const token = await getAccessToken().catch(() => null);
        if (token) headers.set("Authorization", `Bearer ${token}`);
      }

      let response: Response;
      try {
        response = await fetch(endpoint, { ...fetchOptions, headers });
      } catch (err) {
        refreshBalanceAfterSettle();
        throw err;
      }
      refreshBalanceAfterSettle();

      /* Post-spend delta: show what was spent after a successful confirmed call.
         Only for calls that went through confirmation (cost > 0). */
      if (response.ok && paidCall) {
        toast({
          title: `${paidCost.toLocaleString("en-US")} Visual Bucs spent`,
          description: paidFeature,
          duration: 3000,
        });
      }

      return response;
    },
    [confirmSpend, getAccessToken, refreshProfile]
  );

  return { confirmedFetch };
}
