/**
 * AvatarPresenterBench — the Avatar Presenter's native bench
 * in the Video Desk family (Stack 400 world parity, census
 * B-06), stacked inside the Video Desk under the desk itself
 * and its benches: the make-video flow's presenter option,
 * in the room.
 *
 * The 2D panel's own flow on its own rail (lib/world/
 * avatar-presenter-bench.ts): read the provider status, pick
 * a catalog avatar, write the script, generate — 1,200 Bucs
 * behind the spend confirmation, the registry's price — and
 * poll the job to its clip.
 *
 * DARK STATE: the engine is ruled SHIPS DARK (Hedra wallet
 * $0, funding declined). While the status reads
 * configured:false the bench renders the 2D panel's honest
 * unavailable state in its own words, the avatar + script
 * stay editable as a plan note (exactly the 2D behaviour),
 * and there is NO generate control — nothing can charge and
 * nothing pretends to work. The bench lights up by itself
 * the day the server says a provider is connected.
 *
 * Copy rides the worldAvatarPresenterBench.* namespace; the
 * unavailable/ready lines are the 2D panel's own strings.
 */
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clapperboard, Loader2, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage, plainErrorText } from "@/lib/api-error";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { avatarProviderLabel } from "@/lib/provider-display-labels";
import { DeskSelectField, deskInputCls, useDeskAuthHeaders } from "./CreateDeskLeaf";
import { NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  AVATAR_PRESENTER_ASPECTS,
  AVATAR_PRESENTER_COST,
  AVATAR_PRESENTER_FEATURE,
  AVATAR_PRESENTER_POLL_DEADLINE_MS,
  AVATAR_PRESENTER_POLL_MS,
  AVATAR_PRESENTER_SCRIPT_MAX,
  AVATAR_PRESENTER_STATUS_PATH,
  avatarPresenterCanGenerate,
  avatarPresenterJobPath,
  buildAvatarPresenterPayload,
  parseAvatarPresenterJob,
  parseAvatarPresenterStatus,
  presenterJobOutcome,
  presenterSubmitOf,
  type AvatarPresenterAspect,
  type AvatarPresenterStatus,
} from "@/lib/world/avatar-presenter-bench";

type RunState = "idle" | "running" | "done" | "failed";

export function AvatarPresenterBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const authHeaders = useDeskAuthHeaders();

  const [status, setStatus] = useState<AvatarPresenterStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [statusNonce, setStatusNonce] = useState(0);
  const [avatarId, setAvatarId] = useState("");
  const [script, setScript] = useState("");
  const [aspect, setAspect] = useState<AvatarPresenterAspect>("16:9");
  const [run, setRun] = useState<RunState>("idle");
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const labelCls = `text-[11px] font-bold uppercase tracking-widest ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  /* The status read — the bench's only source of truth about
     whether the provider exists at all. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(AVATAR_PRESENTER_STATUS_PATH, { headers: await authHeaders() });
        if (!res.ok) throw new Error("status");
        const data: unknown = await res.json().catch(() => null);
        if (!alive) return;
        setStatus(parseAvatarPresenterStatus(data));
        setStatusFailed(false);
      } catch {
        if (alive) setStatusFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusNonce]);

  const canGenerate = avatarPresenterCanGenerate(status);
  const payload = buildAvatarPresenterPayload({ avatarId, script, aspect });

  function stopPolling() {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  }

  function pollJob(jobId: string, deadline: number) {
    stopPolling();
    pollRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      try {
        const res = await fetch(avatarPresenterJobPath(jobId), { headers: await authHeaders() });
        const data: unknown = await res.json().catch(() => ({}));
        const view = res.ok ? parseAvatarPresenterJob(data) : null;
        if (view) {
          const outcome = presenterJobOutcome(view);
          if (outcome === "done") {
            setClipUrl(view.outputUrl);
            setRun("done");
            refreshProfile();
            return;
          }
          if (outcome === "failed") {
            setError(view.error ?? t("worldAvatarPresenterBench.jobFailed"));
            setRun("failed");
            refreshProfile();
            return;
          }
          if (outcome === "done-no-clip") {
            setError(t("worldAvatarPresenterBench.doneNoClip"));
            setRun("failed");
            refreshProfile();
            return;
          }
        }
      } catch {
        /* a lost poll read is retried until the deadline — the
           job's fate is the server's, not one dropped read's */
      }
      if (!mountedRef.current) return;
      if (Date.now() > deadline) {
        setError(t("worldAvatarPresenterBench.pollTimeout"));
        setRun("failed");
        return;
      }
      pollJob(jobId, deadline);
    }, AVATAR_PRESENTER_POLL_MS);
  }

  async function generate() {
    if (!canGenerate || !payload || run === "running") return;
    setRun("running");
    setError(null);
    setOutOfCredits(false);
    setClipUrl(null);
    try {
      const res = await confirmedFetch("/api/avatar-presenter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: AVATAR_PRESENTER_COST,
        overrideFeature: AVATAR_PRESENTER_FEATURE,
        body: JSON.stringify(payload),
      });
      if (!res) {
        /* Spend confirmation declined — nothing ran, no charge. */
        setRun("idle");
        return;
      }
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {
        setOutOfCredits(true);
        setRun("idle");
        refreshProfile();
        return;
      }
      const jobId = presenterSubmitOf(data);
      if (!res.ok || !jobId) {
        throw new Error(apiErrorMessage(data, t("worldAvatarPresenterBench.failed")));
      }
      refreshProfile();
      pollJob(jobId, Date.now() + AVATAR_PRESENTER_POLL_DEADLINE_MS);
    } catch (e) {
      setError(plainErrorText(e, t("worldAvatarPresenterBench.failed")));
      setRun("failed");
    }
  }

  return (
    <section data-testid="world-avatar-presenter-bench" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <User className="h-4 w-4 text-[#d4af37]" />
        <h3 className={`text-sm font-black uppercase tracking-wider ${strong}`}>
          {t("worldAvatarPresenterBench.title")}
        </h3>
        <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-[#d4af37]">
          {t("worldAvatarPresenterBench.costBadge", { cost: AVATAR_PRESENTER_COST })}
        </span>
      </div>
      <p className={`text-xs ${muted}`}>{t("worldAvatarPresenterBench.subtitle")}</p>

      {status === null && !statusFailed ? (
        <NativeLoadingState isLight={isLight} message={t("worldAvatarPresenterBench.checking")} />
      ) : statusFailed ? (
        <NativeErrorState
          isLight={isLight}
          message={t("worldAvatarPresenterBench.statusFailed")}
          onRetry={() => {
            setStatusFailed(false);
            setStatusNonce((n) => n + 1);
          }}
        />
      ) : !canGenerate ? (
        <>
          <div
            data-testid="world-avatar-presenter-dark"
            className="flex items-start gap-2.5 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300/80" />
            <p className={`text-xs leading-relaxed ${muted}`}>
              {t("worldAvatarPresenterBench.notConfigured")}
            </p>
          </div>
          <DeskSelectField
            isLight={isLight}
            label={t("worldAvatarPresenterBench.avatarLabel")}
            value={avatarId}
            onChange={setAvatarId}
            options={[
              { value: "", label: t("worldAvatarPresenterBench.avatarPlaceholder") },
              ...(status?.catalog ?? []).map((a) => ({
                value: a.id,
                label: a.style ? `${a.name} — ${a.style}` : a.name,
              })),
            ]}
          />
          <label className="block">
            <span className={`mb-1 block ${labelCls}`}>
              {t("worldAvatarPresenterBench.scriptLabel")}
            </span>
            <textarea
              aria-label={t("worldAvatarPresenterBench.scriptLabel")}
              value={script}
              onChange={(e) => setScript(e.target.value.slice(0, AVATAR_PRESENTER_SCRIPT_MAX))}
              placeholder={t("worldAvatarPresenterBench.scriptPlaceholder")}
              className={`${deskInputCls(isLight)} min-h-[90px] resize-none`}
            />
          </label>
          <p className={`text-[11px] leading-relaxed ${muted}`}>
            {t("worldAvatarPresenterBench.savedNote")}
          </p>
        </>
      ) : (
        <>
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300/80" />
            <p className={`text-xs leading-relaxed ${muted}`}>
              {t("worldAvatarPresenterBench.ready", {
                provider: avatarProviderLabel(status?.provider),
              })}
            </p>
          </div>
          <DeskSelectField
            isLight={isLight}
            label={t("worldAvatarPresenterBench.avatarLabel")}
            value={avatarId}
            onChange={setAvatarId}
            options={[
              { value: "", label: t("worldAvatarPresenterBench.avatarPlaceholder") },
              ...(status?.catalog ?? []).map((a) => ({
                value: a.id,
                label: a.style ? `${a.name} — ${a.style}` : a.name,
              })),
            ]}
          />
          <label className="block">
            <span className={`mb-1 block ${labelCls}`}>
              {t("worldAvatarPresenterBench.scriptLabel")}
            </span>
            <textarea
              aria-label={t("worldAvatarPresenterBench.scriptLabel")}
              value={script}
              onChange={(e) => setScript(e.target.value.slice(0, AVATAR_PRESENTER_SCRIPT_MAX))}
              placeholder={t("worldAvatarPresenterBench.scriptPlaceholderLive")}
              className={`${deskInputCls(isLight)} min-h-[90px] resize-none`}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {AVATAR_PRESENTER_ASPECTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAspect(a)}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                  aspect === a
                    ? "border-[#d4af37] bg-[#d4af37]/15 text-[#d4af37]"
                    : `${cardCls} ${muted}`
                }`}
              >
                {a}
              </button>
            ))}
          </div>

          {outOfCredits ? (
            <p data-testid="world-avatar-presenter-out" className={`text-xs font-bold ${strong}`}>
              {t("worldAvatarPresenterBench.outOfCredits", { cost: AVATAR_PRESENTER_COST })}
            </p>
          ) : null}
          {error ? (
            <p data-testid="world-avatar-presenter-error" className={`text-xs font-bold ${strong}`}>
              {error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => void generate()}
            disabled={!payload || run === "running"}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-sm font-black text-black transition hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-50 bdv-touch-target"
          >
            {run === "running" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Clapperboard className="h-4 w-4" />
            )}
            {run === "running"
              ? t("worldAvatarPresenterBench.generating")
              : t("worldAvatarPresenterBench.generate", { cost: AVATAR_PRESENTER_COST })}
          </button>

          {run === "done" && clipUrl ? (
            <div data-testid="world-avatar-presenter-result" className={`rounded-xl border p-3 ${cardCls}`}>
              <video src={clipUrl} controls className="w-full rounded-lg" />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
