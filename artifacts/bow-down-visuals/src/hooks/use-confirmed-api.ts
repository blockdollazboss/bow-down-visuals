import { useCallback } from "react";
import { useCreditConfirm } from "@/contexts/CreditConfirmContext";
import { useAuth } from "@/contexts/AuthContext";
import { getCreditCost } from "@/lib/credit-costs";

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
  const { getAccessToken } = useAuth();

  const confirmedFetch = useCallback(
    async (
      endpoint: string,
      options?: RequestInit & { skipConfirm?: boolean; overrideCost?: number; overrideFeature?: string }
    ): Promise<Response | null> => {
      const { skipConfirm, overrideCost, overrideFeature, ...fetchOptions } = options ?? {};

      if (!skipConfirm) {
        const registered = getCreditCost(endpoint);
        const cost = overrideCost ?? registered?.cost;
        const feature = overrideFeature ?? registered?.feature ?? "AI Feature";

        if (cost && cost > 0) {
          const confirmed = await confirmSpend({ cost, feature });
          if (!confirmed) return null;
        }
      }

      /* Attach the Supabase access token automatically so every authed
         endpoint gets its Bearer header without each page wiring it up.
         Skipped when the caller already set Authorization explicitly. */
      const headers = new Headers(fetchOptions.headers);
      if (!headers.has("Authorization")) {
        const token = await getAccessToken().catch(() => null);
        if (token) headers.set("Authorization", `Bearer ${token}`);
      }

      return fetch(endpoint, { ...fetchOptions, headers });
    },
    [confirmSpend, getAccessToken]
  );

  return { confirmedFetch };
}
