import { apiErrorMessage, plainErrorText } from "../lib/api-error";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Zap, ArrowRight, Plus, Loader2, X, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBalanceRead } from "@/hooks/use-balance-read";
import { decideCreditsGate } from "@/lib/credits-gate";

const IS_DEV = import.meta.env.DEV;

/**
 * OutOfCredits — the "Not Enough Visual Bucs" card.
 *
 * Two ways in, both proven (QC-200 fix queue #2):
 *  - No `cost` prop: the caller renders this only after the server has
 *    refused a charge with 402 / out_of_credits — the refusal IS the
 *    proof of insufficiency.
 *  - `cost` prop: the card passes through the credits gate and renders
 *    ONLY on a proven balance below `cost`. While the balance is still
 *    loading it shows a neutral checking state; if the balance read
 *    failed it shows an honest couldn't-check state with a retry; on a
 *    proven sufficient balance it renders nothing. A page may mount this
 *    form unconditionally — the gate makes the false card impossible.
 */
export function OutOfCredits({ onClose, cost }: { onClose?: () => void; cost?: number }) {
  if (cost === undefined) return <OutOfCreditsCard onClose={onClose} />;
  return <ProvenOutOfCredits cost={cost} onClose={onClose} />;
}

function ProvenOutOfCredits({ cost, onClose }: { cost: number; onClose?: () => void }) {
  const { t } = useTranslation();
  const { read, retry } = useBalanceRead();
  const decision = decideCreditsGate(read, cost);

  if (decision === "nothing") return null;

  if (decision === "checking") {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 py-12 px-6 text-center text-white/50 max-w-md mx-auto"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        <p className="text-sm">{t("outOfCredits.checkingBalance")}</p>
      </div>
    );
  }

  if (decision === "balance-error") {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center text-center py-12 px-6 space-y-3 max-w-md mx-auto"
      >
        <p className="font-bold text-white">{t("outOfCredits.balanceErrorTitle")}</p>
        <p className="text-sm text-white/55 leading-relaxed">{t("outOfCredits.balanceErrorBody")}</p>
        <Button size="sm" variant="outline" onClick={retry} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" /> {t("outOfCredits.retryBtn")}
        </Button>
      </div>
    );
  }

  return <OutOfCreditsCard onClose={onClose} />;
}

function OutOfCreditsCard({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);

  async function handleAddTestCredits() {
    setAdding(true);
    setDevError(null);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/dev/add-credits", { method: "POST", headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: t("outOfCredits.errFailed") })) as { error?: string };
        throw new Error(apiErrorMessage(err, t("outOfCredits.errAdd")));
      }
      await refreshProfile();
      setAdded(true);
    } catch (err) {
      setDevError(plainErrorText(err, t("outOfCredits.errFailed")));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="relative flex flex-col items-center justify-center text-center py-12 px-6 space-y-5 max-w-md mx-auto">
      {onClose && (
        <button
          onClick={onClose}
          aria-label={t("outOfCredits.dismissAria")}
          className="absolute top-2 right-2 p-1.5 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <div className="h-16 w-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
        <Zap className="h-8 w-8 text-primary" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-black text-white">{t("outOfCredits.title")}</h2>
        <p className="text-white/55 text-base leading-relaxed">
          {t("outOfCredits.body")}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-black font-bold shadow-[0_0_16px_rgba(218,165,32,0.35)] gap-2">
          <Link href="/pricing#credit-packs">
            <Zap className="h-4 w-4" /> {t("outOfCredits.buyBtn")}
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-2">
          <Link href="/credit-history">
            {t("outOfCredits.historyBtn")} <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      {IS_DEV && (
        <div className="pt-1">
          <Button
            size="sm"
            onClick={handleAddTestCredits}
            disabled={adding || added}
            className="border border-yellow-500/40 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 gap-2"
            variant="outline"
          >
            {adding ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("outOfCredits.adding")}</>
            ) : added ? (
              <><Plus className="h-3.5 w-3.5" /> {t("outOfCredits.addedBtn")}</>
            ) : (
              <><Plus className="h-3.5 w-3.5" /> {t("outOfCredits.addTestBtn")}</>
            )}
          </Button>
          {devError && <p className="text-red-400 text-xs mt-2">{devError}</p>}
        </div>
      )}
    </div>
  );
}
