/**
 * LlcDesk — the Get Paid room's native LLC Guide desk
 * (stack1500 world parity wave #3, census item 24).
 *
 * Ask the guide LLC questions in a running conversation, and
 * build a step-by-step filing plan for your state — without
 * leaving the World. Both runs are 100 Visual Bucs through
 * the World's confirmed-spend seam (the page's unconfirmed
 * post is not copied): a decline runs nothing, and running
 * out of Bucs lands in the out-of-Bucs state pointing at the
 * Treasury's Visual Buc Packs desk.
 *
 * The page's disclaimer rides along verbatim — this is
 * general information, not legal advice.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import {
  LLC_ASK_COST,
  LLC_ASK_PATH,
  LLC_CREATOR_TYPES,
  LLC_FEATURE_ASK,
  LLC_FEATURE_PLAN,
  LLC_PLAN_COST,
  LLC_PLAN_PATH,
  buildLlcAskPayload,
  buildLlcPlanPayload,
  llcAnswerOf,
  llcPlanOf,
  llcPlanStrings,
  type LlcChatMessage,
  type LlcPlan,
} from "@/lib/world/llc-desk";

/* The creator-type chips' catalog keys (worldTeamLegal) — the
   seam's LLC_CREATOR_TYPES table stays as the fallback behind
   this key-map (its labels are the desk's own composed lines). */
const LLC_CREATOR_TYPE_KEYS: Record<string, string> = {
  musician: "worldTeamLegal.llcCreatorMusician",
  streamer: "worldTeamLegal.llcCreatorStreamer",
  youtuber: "worldTeamLegal.llcCreatorYoutuber",
  podcaster: "worldTeamLegal.llcCreatorPodcaster",
  designer: "worldTeamLegal.llcCreatorDesigner",
  other: "worldTeamLegal.llcCreatorOther",
};

function GuestGate({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  return (
    <div className="space-y-3" data-testid="world-llc-desk">
      <p className={`text-base font-black ${strong}`}>{t("llcGuide.pageTitle")}</p>
      <p className={`text-sm ${muted}`}>
        {t("worldTeamLegal.llcGuestLead")}
      </p>
      <Link
        href="/login"
        data-testid="world-llc-desk-signin"
        className="bdv-touch-target inline-flex items-center gap-1.5 rounded-full border border-[#d4af37] bg-[#d4af37] px-4 py-2 text-xs font-bold text-black"
      >
        {t("worldTeamLegal.llcGuestSignIn")}
      </Link>
    </div>
  );
}

export function LlcDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();
  const [messages, setMessages] = useState<LlcChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [chatState, setChatState] = useState("");
  const [asking, setAsking] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatOut, setChatOut] = useState(false);

  const [planState, setPlanState] = useState("");
  const [creatorType, setCreatorType] = useState("musician");
  const [businessName, setBusinessName] = useState("");
  const [plan, setPlan] = useState<LlcPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planOut, setPlanOut] = useState(false);

  if (isGuest) return <GuestGate isLight={isLight} />;

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/70 text-[#3D2E0A] placeholder:text-[#6B5B36]/60"
      : "border-white/15 bg-black/30 text-white placeholder:text-white/35"
  }`;
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
  const outCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;

  const outOfBucs = (feature: string) => (
    <p className={outCls}>
      {t("worldTeamLegal.outOfBucsLine", { feature })}
    </p>
  );

  async function ask() {
    const q = question.trim();
    if (!q || asking) return;
    const next: LlcChatMessage[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setQuestion("");
    setAsking(true);
    setChatError(null);
    setChatOut(false);
    try {
      const res = await confirmedFetch(LLC_ASK_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildLlcAskPayload(q, chatState, next)),
        overrideCost: LLC_ASK_COST,
        overrideFeature: LLC_FEATURE_ASK,
      });
      if (res === null) {
        setMessages(messages);
        return;
      }
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setChatOut(true);
        setMessages(messages);
        void refreshProfile().catch(() => {});
        return;
      }
      const answer = res.ok ? llcAnswerOf(data) : null;
      if (!answer) throw new Error(apiErrorMessage(data, t("llcGuide.errAnswer")));
      setMessages([...next, { role: "assistant", content: answer }]);
      void refreshProfile().catch(() => {});
    } catch (e) {
      setChatError(plainErrorText(e, t("llcGuide.errAnswer")));
      setMessages(messages);
    } finally {
      setAsking(false);
    }
  }

  async function buildPlan() {
    const payload = buildLlcPlanPayload(planState, creatorType, businessName);
    if (!payload || planning) {
      if (!payload) setPlanError(t("worldTeamLegal.llcPlanStateError"));
      return;
    }
    setPlanning(true);
    setPlanError(null);
    setPlanOut(false);
    try {
      const res = await confirmedFetch(LLC_PLAN_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        overrideCost: LLC_PLAN_COST,
        overrideFeature: LLC_FEATURE_PLAN,
      });
      if (res === null) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setPlanOut(true);
        void refreshProfile().catch(() => {});
        return;
      }
      const parsed = res.ok ? llcPlanOf(data, llcPlanStrings(t)) : null;
      if (!parsed) throw new Error(apiErrorMessage(data, t("worldTeamLegal.llcPlanError")));
      setPlan(parsed);
      void refreshProfile().catch(() => {});
    } catch (e) {
      setPlanError(plainErrorText(e, t("worldTeamLegal.llcPlanError")));
    } finally {
      setPlanning(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="world-llc-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>{t("llcGuide.pageTitle")}</p>
        <p className={`text-xs ${muted}`}>
          {t("worldTeamLegal.llcSubtitle")}
        </p>
      </div>

      <section>
        <p className={`text-sm font-bold ${strong}`}>{t("worldTeamLegal.llcAskSection")}</p>
        {messages.length > 0 ? (
          <ul className="mt-2 space-y-2" data-testid="world-llc-desk-thread">
            {messages.map((m, i) => (
              <li
                key={i}
                className={`rounded-xl border px-3 py-2 text-sm ${cardCls} ${m.role === "user" ? "ml-6" : "mr-6"}`}
              >
                <span className={`block text-[11px] font-bold uppercase tracking-wide ${muted}`}>
                  {m.role === "user" ? t("worldTeamLegal.roleYou") : t("worldTeamLegal.roleGuide")}
                </span>
                <span className={`whitespace-pre-wrap ${strong}`}>{m.content}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-1 text-sm ${muted}`}>
            {t("worldTeamLegal.llcAskEmpty")}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            className={`${inputCls} w-24`}
            data-testid="world-llc-desk-chat-state"
            aria-label={t("worldTeamLegal.llcChatStateAria")}
            placeholder={t("worldTeamLegal.llcStatePlaceholder")}
            maxLength={2}
            value={chatState}
            onChange={(e) => setChatState(e.target.value.toUpperCase())}
          />
          <input
            className={`${inputCls} min-w-52 flex-1`}
            data-testid="world-llc-desk-question"
            aria-label={t("worldTeamLegal.llcQuestionAria")}
            placeholder={t("worldTeamLegal.llcQuestionPlaceholder")}
            maxLength={1000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void ask();
            }}
          />
          <button
            type="button"
            data-testid="world-llc-desk-ask"
            className={goldBtn}
            disabled={asking || question.trim().length === 0}
            onClick={() => void ask()}
          >
            {asking
              ? t("worldTeamLegal.asking")
              : t("worldTeamLegal.askButton", { cost: LLC_ASK_COST })}
          </button>
        </div>
        {chatOut ? outOfBucs(LLC_FEATURE_ASK) : null}
        {chatError ? <p className={errCls}>{chatError}</p> : null}
      </section>

      <section>
        <p className={`text-sm font-bold ${strong}`}>{t("worldTeamLegal.llcPlanSection")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            className={`${inputCls} w-24`}
            data-testid="world-llc-desk-plan-state"
            aria-label={t("worldTeamLegal.llcPlanStateAria")}
            placeholder={t("worldTeamLegal.llcStatePlaceholder")}
            maxLength={2}
            value={planState}
            onChange={(e) => setPlanState(e.target.value.toUpperCase())}
          />
          <input
            className={`${inputCls} min-w-44 flex-1`}
            aria-label={t("worldTeamLegal.llcBusinessName")}
            placeholder={t("worldTeamLegal.llcBusinessName")}
            maxLength={120}
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {LLC_CREATOR_TYPES.map((ct) => (
            <button
              key={ct.key}
              type="button"
              className={chipCls(creatorType === ct.key)}
              onClick={() => setCreatorType(ct.key)}
            >
              {t(LLC_CREATOR_TYPE_KEYS[ct.key] ?? "worldTeamLegal.llcCreatorOther")}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="world-llc-desk-plan"
          className={`mt-2 ${goldBtn}`}
          disabled={planning}
          onClick={() => void buildPlan()}
        >
          {planning
            ? t("worldTeamLegal.llcBuilding")
            : t("worldTeamLegal.llcPlanButton", { cost: LLC_PLAN_COST })}
        </button>
        {planOut ? outOfBucs(LLC_FEATURE_PLAN) : null}
        {planError ? <p className={errCls}>{planError}</p> : null}
        {plan ? (
          <div className={`mt-3 rounded-xl border p-3 ${cardCls}`} data-testid="world-llc-desk-plan-result">
            <p className={`text-sm font-bold ${strong}`}>{plan.title}</p>
            {plan.totalEstimate ? (
              <p className={`text-xs ${muted}`}>{t("worldTeamLegal.llcEstimatedTotal", { total: plan.totalEstimate })}</p>
            ) : null}
            <ol className="mt-2 space-y-2">
              {plan.steps.map((s, i) => (
                <li key={i} className={`text-sm ${muted}`}>
                  <span className={`font-bold ${strong}`}>
                    {i + 1}. {s.title}
                  </span>{" "}
                  — {s.detail}
                  {s.estCost ? <span className="block text-xs">{t("worldTeamLegal.llcStepCost", { cost: s.estCost })}</span> : null}
                  {s.timeline ? <span className="block text-xs">{t("worldTeamLegal.llcStepTiming", { timeline: s.timeline })}</span> : null}
                </li>
              ))}
            </ol>
            {plan.notes.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {plan.notes.map((n, i) => (
                  <li key={i} className={`text-xs ${muted}`}>{n}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <p className={`text-xs ${muted}`} data-testid="world-llc-desk-disclaimer">
        {/* The catalog's disclaimerBody carries its own leading space
            (the 2D page's established value) — no extra JSX space here,
            so the rendered line stays byte-identical to the old one. */}
        <span className={`font-bold ${strong}`}>{t("llcGuide.disclaimerTitle")}</span>
        {t("llcGuide.disclaimerBody")}
      </p>
    </div>
  );
}
