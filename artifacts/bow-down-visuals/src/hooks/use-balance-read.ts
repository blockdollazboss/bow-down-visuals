import { useAuth } from "@/contexts/AuthContext";
import { balanceReadFromAuth, type BalanceRead } from "@/lib/credits-gate";

/**
 * useBalanceRead — the auth-backed BalanceRead for the credits gate.
 * `retry` re-runs the profile fetch, which is the balance read.
 */
export function useBalanceRead(): { read: BalanceRead; retry: () => void } {
  const { user, profile, loading, refreshProfile } = useAuth();
  const read = balanceReadFromAuth({
    loading,
    hasUser: !!user,
    profileCredits:
      profile && typeof profile.credits === "number" ? profile.credits : null,
  });
  return {
    read,
    retry: () => {
      void refreshProfile();
    },
  };
}
