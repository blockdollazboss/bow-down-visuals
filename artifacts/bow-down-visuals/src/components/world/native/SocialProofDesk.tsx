/**
 * SocialProofDesk — the My Studio board's native Social Proof
 * desk (stack1500 world parity wave #3, census item 32).
 *
 * Your verified audience figures, managed without leaving the
 * World: the numbers your connected Instagram / Facebook /
 * TikTok accounts vouch for on your public profile, a free live
 * refresh, and the per-figure off switch — hide one and it
 * vanishes from your profile for everyone, instantly, exactly
 * like the website's settings card.
 *
 * Everything here is free (the refresh rail's registry row is
 * cost 0), so the desk rides plain authed fetches like the card
 * does. The honest states stay separate: not-switched-on (the
 * rail's 503), no profile yet, no figures yet, and a failed load
 * with a retry — none of them dressed as another.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatProofValue } from "@/lib/social-proof-display";
import {
  SOCIAL_PROOF_ME_PATH,
  SOCIAL_PROOF_REFRESH_PATH,
  SOCIAL_PROOF_VISIBILITY_PATH,
  buildVisibilityPayload,
  hiddenKeysAfterToggle,
  platformLabel,
  socialProofStateOf,
  type SocialProofFigure,
  type SocialProofState,
} from "@/lib/world/social-proof-desk";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";

type LoadState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "failed" }
  | { kind: "ready"; state: SocialProofState };

export function SocialProofDesk({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const deskHeaders = useDeskAuthHeaders();
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;
  const goldBtn =
    "bdv-touch-target rounded-lg bg-[#d4af37] px-4 py-2 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50";
  const errCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;

  const loadState = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const headers = await deskHeaders();
      const res = await fetch(SOCIAL_PROOF_ME_PATH, { headers });
      if (res.status === 503) {
        setLoad({ kind: "unavailable" });
        return;
      }
      if (!res.ok) throw new Error("load failed");
      const state = socialProofStateOf(await res.json().catch(() => ({})));
      if (!state) throw new Error("load failed");
      setLoad({ kind: "ready", state });
    } catch {
      setLoad({ kind: "failed" });
    }
  }, [deskHeaders]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setActionError(null);
    try {
      const headers = await deskHeaders();
      const res = await fetch(SOCIAL_PROOF_REFRESH_PATH, { method: "POST", headers });
      if (!res.ok) throw new Error("refresh failed");
      const state = socialProofStateOf(await res.json().catch(() => ({})));
      if (!state) throw new Error("refresh failed");
      setLoad({ kind: "ready", state });
    } catch {
      setActionError(t("worldSocialDesk.proofRefreshError"));
    } finally {
      setRefreshing(false);
    }
  }

  async function toggle(figure: SocialProofFigure, show: boolean) {
    if (load.kind !== "ready" || savingKey) return;
    const state = load.state;
    const hiddenKeys = hiddenKeysAfterToggle(state.hiddenKeys, figure.key, show);
    setSavingKey(figure.key);
    setActionError(null);
    /* Optimistic flip (the settings card's behaviour), reverted
       whole if the save refuses. */
    setLoad({
      kind: "ready",
      state: {
        ...state,
        hiddenKeys,
        figures: state.figures.map((f) => (f.key === figure.key ? { ...f, visible: show } : f)),
      },
    });
    try {
      const headers = await deskHeaders();
      const res = await fetch(SOCIAL_PROOF_VISIBILITY_PATH, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(buildVisibilityPayload(hiddenKeys)),
      });
      if (!res.ok) throw new Error("save failed");
      const saved = socialProofStateOf(await res.json().catch(() => ({})));
      if (!saved) throw new Error("save failed");
      setLoad({ kind: "ready", state: saved });
    } catch {
      setActionError(t("worldSocialDesk.proofSaveError"));
      setLoad({ kind: "ready", state });
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-3" data-testid="world-social-proof-desk">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className={`text-base font-black ${strong}`}>{t("worldSocialDesk.proofTitle")}</p>
          <p className={`text-xs ${muted}`}>{t("worldSocialDesk.proofIntro")}</p>
        </div>
        {load.kind === "ready" && load.state.hasProfile ? (
          <button
            type="button"
            data-testid="world-social-proof-desk-refresh"
            className={`ml-auto ${goldBtn}`}
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? t("social-proof.refreshing") : t("worldSocialDesk.proofRefreshButton")}
          </button>
        ) : null}
      </div>

      {load.kind === "loading" ? (
        <p className={`text-sm ${muted}`} data-testid="world-social-proof-desk-loading">
          {t("worldSocialDesk.proofLoading")}
        </p>
      ) : null}

      {load.kind === "unavailable" ? (
        <p className={`text-sm ${muted}`} data-testid="world-social-proof-desk-unavailable">
          {t("worldSocialDesk.proofNotReady")}
        </p>
      ) : null}

      {load.kind === "failed" ? (
        <div data-testid="world-social-proof-desk-failed">
          <p className={errCls}>{t("worldSocialDesk.proofLoadError")}</p>
          <button type="button" className={`mt-2 ${chipCls(false)}`} onClick={() => void loadState()}>
            {t("social-proof.retry")}
          </button>
        </div>
      ) : null}

      {load.kind === "ready" && !load.state.hasProfile ? (
        <p className={`text-sm ${muted}`} data-testid="world-social-proof-desk-no-profile">
          {t("worldSocialDesk.proofNoProfile")}
        </p>
      ) : null}

      {load.kind === "ready" && load.state.hasProfile ? (
        <div className="space-y-2" data-testid="world-social-proof-desk-figures">
          {load.state.connectedPlatforms.length > 0 ? (
            <p className={`text-xs ${muted}`}>
              {t("worldSocialDesk.proofConnected", {
                platforms: load.state.connectedPlatforms.map(platformLabel).join(" · "),
              })}
              {load.state.refreshedAt
                ? t("worldSocialDesk.proofLastSynced", {
                    date: new Date(load.state.refreshedAt).toLocaleDateString(i18n.language),
                  })
                : ""}
              {load.state.stale ? t("worldSocialDesk.proofStale") : ""}
            </p>
          ) : null}
          {load.state.figures.length === 0 ? (
            <p className={`text-sm ${muted}`}>
              {t("worldSocialDesk.proofNoFigures")}
            </p>
          ) : (
            load.state.figures.map((figure) => (
              <div
                key={figure.key}
                className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${cardCls}`}
                data-testid={`world-social-proof-desk-figure-${figure.key}`}
              >
                <div className="min-w-0">
                  <p className={`text-sm font-bold ${strong}`}>
                    {figure.label}
                    <span className={`ml-2 font-black ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                      {formatProofValue(figure.value, i18n.language)}
                    </span>
                  </p>
                  <p className={`text-xs ${muted}`}>
                    {figure.accountLabel || platformLabel(figure.platform)}
                    {!figure.connected ? t("worldSocialDesk.proofDisconnected") : ""}
                  </p>
                </div>
                <button
                  type="button"
                  data-testid={`world-social-proof-desk-toggle-${figure.key}`}
                  aria-pressed={figure.visible}
                  className={`ml-auto ${chipCls(figure.visible)}`}
                  disabled={savingKey !== null}
                  onClick={() => void toggle(figure, !figure.visible)}
                >
                  {figure.visible ? t("worldSocialDesk.proofShowing") : t("worldSocialDesk.proofHidden")}
                </button>
              </div>
            ))
          )}
          {actionError ? <p className={errCls}>{actionError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
