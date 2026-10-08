import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Vault, Loader2, AlertTriangle, BadgeCheck } from "lucide-react";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── Catalog Vault ("Leave a Legacy" parity) ─────────────────────────────
   Per-release one-time purchase: 200 Visual Bucs. Guarantees the release's
   presave page, showcase entry and assets stay live permanently on Bow Down
   Visuals — our own hosting, a guarantee we CAN make.

   Mounted inside the release detail on /distribute; a gold "Vaulted" badge
   marks vaulted releases in the release list. Charge flow: 402 → charge →
   auto-refund, with the credit-confirm popup up front (registry entry
   /api/catalog-vault/vault = 200 VB). */

const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

export function CatalogVaultPanel(props: {
  releaseId: string;
  releaseTitle: string;
  vaulted: boolean;
  onVaulted: (releaseId: string) => void;
  onOutOfCredits: () => void;
  onError: (msg: string | null) => void;
  refreshProfile: () => void;
}) {
  const { t } = useTranslation();
  const { releaseId, releaseTitle, vaulted, onVaulted, onOutOfCredits, onError, refreshProfile } = props;
  const { confirmedFetch } = useConfirmedApi();
  const [vaulting, setVaulting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function vaultRelease() {
    if (vaulting || vaulted) return;
    setVaulting(true);
    setLocalError(null);
    onError(null);
    try {
      const res = await confirmedFetch("/api/catalog-vault/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId }),
      });
      if (!res) { setVaulting(false); return; } // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as {
        vaulted?: boolean; alreadyVaulted?: boolean; error?: string; message?: string;
      };
      if (data.error === "out_of_credits") {
        onOutOfCredits();
        refreshProfile();
        setVaulting(false);
        return;
      }
      if (!res.ok) throw new Error(data.message ?? data.error ?? t("catalogVault.vaultFailed"));
      refreshProfile();
      onVaulted(releaseId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("catalogVault.vaultFailed");
      setLocalError(msg);
      onError(msg);
    } finally {
      setVaulting(false);
    }
  }

  return (
    <section className="rounded-3xl border border-primary/30 bg-gradient-to-b from-[#171208] to-black p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-xl font-black text-white">
          <Vault className="h-5 w-5 text-primary" aria-hidden="true" />
          {t("catalogVault.title")}
        </h3>
        {vaulted && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/60 bg-primary/15 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-primary">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t("catalogVault.vaulted")}
          </span>
        )}
      </div>

      {vaulted ? (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/60">
          {t("catalogVault.vaultedCopy", { title: releaseTitle })}
        </p>
      ) : (
        <>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/60">
            {t("catalogVault.copy")}
          </p>
          <ul className="mt-4 space-y-1.5 text-sm text-white/55">
            <li className="flex items-center gap-2">
              <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {t("catalogVault.guarantee1")}
            </li>
            <li className="flex items-center gap-2">
              <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {t("catalogVault.guarantee2")}
            </li>
            <li className="flex items-center gap-2">
              <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {t("catalogVault.guarantee3")}
            </li>
          </ul>
          {localError && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{localError}</p>
            </div>
          )}
          <button onClick={() => void vaultRelease()} disabled={vaulting} className={`${goldBtn} mt-5`}>
            {vaulting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Vault className="h-4 w-4" />}
            {vaulting ? t("catalogVault.vaulting") : t("catalogVault.vaultButton")}
          </button>
        </>
      )}
    </section>
  );
}
