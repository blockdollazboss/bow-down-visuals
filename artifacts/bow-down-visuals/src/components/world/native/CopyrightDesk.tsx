/**
 * CopyrightDesk — the Get Paid room's native Copyright desk
 * (stack1500 world parity wave #3, census item 23).
 *
 * Draft the "description of work" + filing notes for a U.S.
 * Copyright Office application, and ask copyright questions
 * in a running conversation — without leaving the World.
 * Both runs are 100 Visual Bucs through the World's
 * confirmed-spend seam: a decline runs nothing, and running
 * out of Bucs lands in the out-of-Bucs state pointing at the
 * Treasury's Visual Buc Packs desk.
 *
 * The page's disclaimer rides along verbatim — this is not a
 * law firm and this is not legal advice.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import {
  COPYRIGHT_ASK_COST,
  COPYRIGHT_ASK_PATH,
  COPYRIGHT_DRAFT_COST,
  COPYRIGHT_DRAFT_PATH,
  COPYRIGHT_FEATURE_ASK,
  COPYRIGHT_FEATURE_DRAFT,
  COPYRIGHT_WORK_TYPES,
  buildCopyrightAskPayload,
  buildCopyrightDraftPayload,
  copyrightAnswerOf,
  copyrightDraftOf,
  type CopyrightChatMessage,
  type CopyrightDraft,
  type CopyrightDraftForm,
} from "@/lib/world/copyright-desk";

/* The work-type chips' catalog keys (worldTeamLegal) — the seam's
   COPYRIGHT_WORK_TYPES table stays as the fallback behind this
   key-map (its labels are the desk's own composed lines, longer
   than the 2D page's label+hint pairs). */
const COPYRIGHT_WORK_TYPE_KEYS: Record<string, string> = {
  song: "worldTeamLegal.copyrightWorkSong",
  "sound-recording": "worldTeamLegal.copyrightWorkRecording",
  lyrics: "worldTeamLegal.copyrightWorkLyrics",
  "music-video": "worldTeamLegal.copyrightWorkVideo",
  album: "worldTeamLegal.copyrightWorkAlbum",
};

function GuestGate({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  return (
    <div className="space-y-3" data-testid="world-copyright-desk">
      <p className={`text-base font-black ${strong}`}>{t("worldTeamLegal.copyrightTitle")}</p>
      <p className={`text-sm ${muted}`}>
        {t("worldTeamLegal.copyrightGuestLead")}
      </p>
      <Link
        href="/login"
        data-testid="world-copyright-desk-signin"
        className="bdv-touch-target inline-flex items-center gap-1.5 rounded-full border border-[#d4af37] bg-[#d4af37] px-4 py-2 text-xs font-bold text-black"
      >
        {t("worldTeamLegal.copyrightGuestSignIn")}
      </Link>
    </div>
  );
}

const EMPTY_FORM: CopyrightDraftForm = {
  workType: "song",
  title: "",
  authors: "",
  creationDate: "",
  published: false,
  publishedDate: "",
  notes: "",
};

export function CopyrightDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();
  const [form, setForm] = useState<CopyrightDraftForm>(EMPTY_FORM);
  const [draft, setDraft] = useState<CopyrightDraft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftOut, setDraftOut] = useState(false);

  const [messages, setMessages] = useState<CopyrightChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askOut, setAskOut] = useState(false);

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

  const outOfBucs = (feature: string) => (
    <p className={errCls}>
      {t("worldTeamLegal.outOfBucsLine", { feature })}
    </p>
  );

  const set = (patch: Partial<CopyrightDraftForm>) => setForm((f) => ({ ...f, ...patch }));

  async function runDraft() {
    const payload = buildCopyrightDraftPayload(form);
    if (!payload || drafting) {
      if (!payload) setDraftError(t("worldTeamLegal.copyrightDraftTitleError"));
      return;
    }
    setDrafting(true);
    setDraftError(null);
    setDraftOut(false);
    try {
      const res = await confirmedFetch(COPYRIGHT_DRAFT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        overrideCost: COPYRIGHT_DRAFT_COST,
        overrideFeature: COPYRIGHT_FEATURE_DRAFT,
      });
      if (res === null) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setDraftOut(true);
        void refreshProfile().catch(() => {});
        return;
      }
      const parsed = res.ok ? copyrightDraftOf(data) : null;
      if (!parsed) throw new Error(apiErrorMessage(data, t("worldTeamLegal.copyrightDraftError")));
      setDraft(parsed);
      void refreshProfile().catch(() => {});
    } catch (e) {
      setDraftError(plainErrorText(e, t("worldTeamLegal.copyrightDraftError")));
    } finally {
      setDrafting(false);
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || asking) return;
    const next: CopyrightChatMessage[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setQuestion("");
    setAsking(true);
    setAskError(null);
    setAskOut(false);
    try {
      const res = await confirmedFetch(COPYRIGHT_ASK_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCopyrightAskPayload(q, next)),
        overrideCost: COPYRIGHT_ASK_COST,
        overrideFeature: COPYRIGHT_FEATURE_ASK,
      });
      if (res === null) {
        setMessages(messages);
        return;
      }
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setAskOut(true);
        setMessages(messages);
        void refreshProfile().catch(() => {});
        return;
      }
      const answer = res.ok ? copyrightAnswerOf(data) : null;
      if (!answer) throw new Error(apiErrorMessage(data, t("worldTeamLegal.copyrightAnswerError")));
      setMessages([...next, { role: "assistant", content: answer }]);
      void refreshProfile().catch(() => {});
    } catch (e) {
      setAskError(plainErrorText(e, t("worldTeamLegal.copyrightAnswerError")));
      setMessages(messages);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="world-copyright-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>{t("worldTeamLegal.copyrightTitle")}</p>
        <p className={`text-xs ${muted}`}>
          {t("worldTeamLegal.copyrightSubtitle")}
        </p>
      </div>

      <section>
        <p className={`text-sm font-bold ${strong}`}>{t("worldTeamLegal.copyrightDraftSection")}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {COPYRIGHT_WORK_TYPES.map((wt) => (
            <button
              key={wt.key}
              type="button"
              className={chipCls(form.workType === wt.key)}
              onClick={() => set({ workType: wt.key })}
            >
              {t(COPYRIGHT_WORK_TYPE_KEYS[wt.key] ?? "worldTeamLegal.copyrightWorkSong")}
            </button>
          ))}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className={`text-xs ${muted}`}>
            {t("worldTeamLegal.copyrightTitleLabel")}
            <input
              className={`${inputCls} mt-1`}
              data-testid="world-copyright-desk-title"
              maxLength={200}
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </label>
          <label className={`text-xs ${muted}`}>
            {t("copyright.author_s_claimant_s")}
            <input
              className={`${inputCls} mt-1`}
              maxLength={500}
              value={form.authors}
              onChange={(e) => set({ authors: e.target.value })}
            />
          </label>
          <label className={`text-xs ${muted}`}>
            {t("worldTeamLegal.copyrightDateLabel")}
            <input
              className={`${inputCls} mt-1`}
              maxLength={20}
              placeholder="e.g. 2026-03-14"
              value={form.creationDate}
              onChange={(e) => set({ creationDate: e.target.value })}
            />
          </label>
          <label className={`flex items-end gap-2 text-xs ${muted}`}>
            <input
              type="checkbox"
              data-testid="world-copyright-desk-published"
              checked={form.published}
              onChange={(e) => set({ published: e.target.checked })}
            />
            {t("worldTeamLegal.copyrightPublishedLabel")}
          </label>
          {form.published ? (
            <label className={`text-xs ${muted}`}>
              {t("worldTeamLegal.copyrightPubDateLabel")}
              <input
                className={`${inputCls} mt-1`}
                maxLength={20}
                placeholder="e.g. 2026-04-01"
                value={form.publishedDate}
                onChange={(e) => set({ publishedDate: e.target.value })}
              />
            </label>
          ) : null}
          <label className={`text-xs ${muted} sm:col-span-2`}>
            {t("worldTeamLegal.copyrightNotesLabel")}
            <textarea
              className={`${inputCls} mt-1`}
              rows={2}
              maxLength={1000}
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </label>
        </div>
        <button
          type="button"
          data-testid="world-copyright-desk-draft"
          className={`mt-2 ${goldBtn}`}
          disabled={drafting}
          onClick={() => void runDraft()}
        >
          {drafting
            ? t("worldTeamLegal.copyrightDrafting")
            : t("worldTeamLegal.copyrightDraftButton", { cost: COPYRIGHT_DRAFT_COST })}
        </button>
        {draftOut ? outOfBucs(COPYRIGHT_FEATURE_DRAFT) : null}
        {draftError ? <p className={errCls}>{draftError}</p> : null}
        {draft ? (
          <div className={`mt-3 rounded-xl border p-3 ${cardCls}`} data-testid="world-copyright-desk-draft-result">
            <p className={`text-xs font-bold uppercase tracking-wide ${muted}`}>{t("copyright.description_of_work")}</p>
            <p className={`mt-1 whitespace-pre-wrap text-sm ${strong}`}>{draft.description}</p>
            {draft.filingNotes.length > 0 ? (
              <>
                <p className={`mt-3 text-xs font-bold uppercase tracking-wide ${muted}`}>{t("copyright.filing_notes")}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {draft.filingNotes.map((n, i) => (
                    <li key={i} className={`text-sm ${muted}`}>{n}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <section>
        <p className={`text-sm font-bold ${strong}`}>{t("copyright.ask_about_copyright")}</p>
        {messages.length > 0 ? (
          <ul className="mt-2 space-y-2" data-testid="world-copyright-desk-thread">
            {messages.map((m, i) => (
              <li
                key={i}
                className={`rounded-xl border px-3 py-2 text-sm ${cardCls} ${m.role === "user" ? "ml-6" : "mr-6"}`}
              >
                <span className={`block text-[11px] font-bold uppercase tracking-wide ${muted}`}>
                  {m.role === "user" ? t("worldTeamLegal.roleYou") : t("worldTeamLegal.roleAssistant")}
                </span>
                <span className={`whitespace-pre-wrap ${strong}`}>{m.content}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-1 text-sm ${muted}`}>
            {t("worldTeamLegal.copyrightAskEmpty")}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            className={`${inputCls} min-w-52 flex-1`}
            data-testid="world-copyright-desk-question"
            aria-label={t("copyright.ask_about_copyright")}
            placeholder={t("worldTeamLegal.copyrightAskPlaceholder")}
            maxLength={1000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void ask();
            }}
          />
          <button
            type="button"
            data-testid="world-copyright-desk-ask"
            className={goldBtn}
            disabled={asking || question.trim().length === 0}
            onClick={() => void ask()}
          >
            {asking
              ? t("worldTeamLegal.asking")
              : t("worldTeamLegal.askButton", { cost: COPYRIGHT_ASK_COST })}
          </button>
        </div>
        {askOut ? outOfBucs(COPYRIGHT_FEATURE_ASK) : null}
        {askError ? <p className={errCls}>{askError}</p> : null}
      </section>

      <p className={`text-xs ${muted}`} data-testid="world-copyright-desk-disclaimer">
        {t("worldTeamLegal.copyrightDisclaimer")}
      </p>
    </div>
  );
}
