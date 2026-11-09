import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@/lib/api-error";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import {
  SOCIAL_PUBLISH_PATHS,
  SCHEDULER_PLATFORMS,
  buildSocialPublishPayload,
  classifySocialPublishResponse,
  loadSocialPublishKey,
  resolveAccountId,
  retireSocialPublishKey,
  socialPublishCost,
  validateSocialPublish,
  type SchedulerAccount,
  type SchedulerComposeDraft,
  type SchedulerPlatformKey,
} from "@/lib/world/scheduler-desk";
import { NativeEmptyState } from "./NativeStates";

/* ─── Scheduler publish bench (Stack-400 census B item B-12) ────────
   Publish-now actions for the Scheduler Desk. The desk handled
   accounts, auth and scheduling; actually publishing rode only the
   2D post modals. This bench puts the same four publish rails —
   POST /api/social/{platform}/publish at the registry's 100 Visual
   Bucs each — on the desk's own composer: whatever is composed
   (media, caption, hashtags, per-platform accounts) can go out NOW
   per selected platform, through confirmedFetch exactly like the
   modals, so the member confirms the charge first and a cancel is
   no charge and no error.

   Honest platform shape, in the modals' own words: TikTok publishes
   land in the member's TikTok drafts (never auto-posted), Facebook
   videos surface as Reels, X refuses over 280 characters in words
   instead of truncating. A 409 publish_in_progress answer reads as
   "already publishing", never as an error. */

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target";

type PublishRowState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "error"; message: string }
  | { kind: "notice"; message: string }
  | { kind: "done"; message: string; permalink: string | null };

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function SchedulerPublishBench({
  isLight,
  draft,
  accounts,
}: {
  isLight: boolean;
  draft: SchedulerComposeDraft;
  accounts: SchedulerAccount[];
}) {
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [rows, setRows] = useState<Partial<Record<SchedulerPlatformKey, PublishRowState>>>({});
  const keysCache = useRef(new Map<string, string>());

  const labelOf = (platform: SchedulerPlatformKey) =>
    SCHEDULER_PLATFORMS.find((p) => p.key === platform)?.label ?? platform;

  const publishStrings = {
    needMedia: t("worldSchedulerPublish.needMedia"),
    needVideo: t("worldSchedulerPublish.needVideo"),
    needAccount: t("worldSchedulerPublish.needAccount"),
    needText: t("worldSchedulerPublish.needText"),
    textTooLong: t("worldSchedulerPublish.textTooLong"),
  };

  const failedFallback = (platform: SchedulerPlatformKey): string =>
    platform === "instagram"
      ? t("worldSchedulerPublish.failedInstagram")
      : platform === "tiktok"
        ? t("worldSchedulerPublish.failedTiktok")
        : platform === "facebook"
          ? t("worldSchedulerPublish.failedFacebook")
          : t("worldSchedulerPublish.failedX");

  const inProgressLine = (platform: SchedulerPlatformKey): string =>
    platform === "instagram"
      ? t("worldSchedulerPublish.inProgressInstagram")
      : platform === "tiktok"
        ? t("worldSchedulerPublish.inProgressTiktok")
        : platform === "facebook"
          ? t("worldSchedulerPublish.inProgressFacebook")
          : t("worldSchedulerPublish.inProgressX");

  const doneLine = (platform: SchedulerPlatformKey): string =>
    platform === "instagram"
      ? t("worldSchedulerPublish.postedInstagram")
      : platform === "tiktok"
        ? t("worldSchedulerPublish.sentTiktok")
        : platform === "facebook"
          ? t("worldSchedulerPublish.postedFacebook")
          : t("worldSchedulerPublish.postedX");

  const setRow = (platform: SchedulerPlatformKey, state: PublishRowState) =>
    setRows((prev) => ({ ...prev, [platform]: state }));

  const publish = async (platform: SchedulerPlatformKey) => {
    const refusal = validateSocialPublish(platform, draft, accounts, publishStrings);
    if (refusal) {
      setRow(platform, { kind: "error", message: refusal });
      return;
    }
    const storage = sessionStorageOrNull();
    const idempotencyKey = loadSocialPublishKey(
      platform,
      draft.mediaUrl,
      storage,
      keysCache.current,
    );
    const payload = buildSocialPublishPayload(platform, draft, accounts, idempotencyKey);
    if (!payload) {
      setRow(platform, {
        kind: "error",
        message: t("worldSchedulerPublish.needAccount", { label: labelOf(platform) }),
      });
      return;
    }
    setRow(platform, { kind: "busy" });
    try {
      const res = await confirmedFetch(SOCIAL_PUBLISH_PATHS[platform], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res) {
        /* Confirmation canceled — the modals' rule: no charge, no error. */
        setRow(platform, { kind: "idle" });
        return;
      }
      const data = await res.json().catch(() => null);
      const outcome = classifySocialPublishResponse(
        res.status,
        data,
        apiErrorMessage(data, failedFallback(platform)),
      );
      if (outcome.kind === "out-of-credits") {
        void refreshProfile().catch(() => undefined);
        setRow(platform, {
          kind: "error",
          message: t("worldSchedulerPublish.outOfBucs", { cost: socialPublishCost(platform) }),
        });
        return;
      }
      if (outcome.kind === "in-progress") {
        setRow(platform, { kind: "notice", message: inProgressLine(platform) });
        return;
      }
      if (outcome.kind === "failed") {
        setRow(platform, { kind: "error", message: outcome.message });
        return;
      }
      retireSocialPublishKey(platform, draft.mediaUrl, storage, keysCache.current);
      void refreshProfile().catch(() => undefined);
      setRow(platform, {
        kind: "done",
        message: outcome.result.deliveredToDrafts
          ? t("worldSchedulerPublish.sentTiktok")
          : doneLine(platform),
        permalink: outcome.result.permalink,
      });
    } catch {
      setRow(platform, { kind: "error", message: failedFallback(platform) });
    }
  };

  const cost = socialPublishCost("instagram");

  return (
    <div
      data-testid="world-scheduler-publish"
      className={`mt-4 rounded-2xl border p-3 ${
        isLight ? "border-[#d8c08a]/60 bg-[#fff8e6]" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <p className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
        {t("worldSchedulerPublish.title")}
      </p>
      <p className={`mt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
        {t("worldSchedulerPublish.intro", { cost })}
      </p>
      {draft.platforms.length === 0 ? (
        <NativeEmptyState isLight={isLight} message={t("worldSchedulerPublish.needPlatform")} />
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {draft.platforms.map((platform) => {
            const state = rows[platform] ?? { kind: "idle" };
            const accountId = resolveAccountId(accounts, platform, draft.accountIds[platform]);
            const account = accounts.find((a) => a.id === accountId) ?? null;
            return (
              <div key={platform} data-testid={`world-scheduler-publish-row-${platform}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-xs font-bold ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}
                  >
                    {labelOf(platform)}
                  </span>
                  {account ? (
                    <span className={`text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
                      {account.label}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    data-testid={`world-scheduler-publish-${platform}`}
                    onClick={() => void publish(platform)}
                    disabled={state.kind === "busy"}
                    className={goldBtn}
                  >
                    {state.kind === "busy"
                      ? t("worldSchedulerPublish.publishing")
                      : t("worldSchedulerPublish.publishButton", {
                          label: labelOf(platform),
                          cost: socialPublishCost(platform),
                        })}
                  </button>
                </div>
                {state.kind === "error" ? (
                  <p
                    data-testid={`world-scheduler-publish-error-${platform}`}
                    className="mt-1 text-xs font-semibold text-red-400"
                  >
                    {state.message}
                  </p>
                ) : null}
                {state.kind === "notice" ? (
                  <p
                    data-testid={`world-scheduler-publish-notice-${platform}`}
                    className={`mt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}
                  >
                    {state.message}
                  </p>
                ) : null}
                {state.kind === "done" ? (
                  <p
                    data-testid={`world-scheduler-publish-done-${platform}`}
                    className={`mt-1 text-xs font-semibold ${
                      isLight ? "text-[#2a1e07]" : "text-[#d4af37]"
                    }`}
                  >
                    {state.message}
                    {state.permalink ? (
                      <>
                        {" "}
                        <a
                          href={state.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          {t("worldSchedulerPublish.viewPost")}
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
