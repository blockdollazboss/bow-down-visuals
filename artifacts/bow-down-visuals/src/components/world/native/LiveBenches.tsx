/**
 * LiveBenches — the go-live family's two prep tools, native
 * at the Live Desk (Stack 400 world parity, census B-11 +
 * B-15), stacked at the foot of the Live Desks panel:
 *
 *  - ShowFinderBench: the Show Finder's own flow on its own
 *    rails (lib/world/live-benches.ts) — city + genre + the
 *    six opportunity types + date window, the 200-Buc hunt
 *    rides the registry-priced spend confirmation, and each
 *    stage it finds can draft its 100-Buc pitch on the pitch
 *    rail. An empty hunt is a real answer (the page's own
 *    zero-match copy), never a failure.
 *  - GuestQuestionsBench: the Podcast Guest Questions flow —
 *    guest + topic + pasted research (the honesty rule rides
 *    along: research comes ONLY from what the host pastes),
 *    the 75-Buc generation rides the same confirmation, and
 *    the finished set copies / downloads exactly like the
 *    page's.
 *
 * Both benches render the pages' own catalog copy (shows.*
 * and podcast.guestQuestions.*) so their labels can never
 * drift from the pages', and every state runs through the
 * NativeStates trio — loading, empty, and a failed state
 * with a retry.
 */
import { useState } from "react";
import {
  AlertTriangle, Building2, CalendarDays, Check, CheckCircle2, Copy,
  Download, Flag, Flame, Loader2, MapPin, MessagesSquare, Mic2,
  PartyPopper, Podcast, Radio, Search, Sparkles, Ticket, Trophy, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { apiErrorMessage, plainErrorText } from "@/lib/api-error";
import { DeskTextField, deskInputCls } from "./CreateDeskLeaf";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  GUEST_QUESTIONS_PATH,
  GUEST_QUESTION_SECTIONS,
  SHOW_DATE_WINDOWS,
  SHOW_DATE_WINDOW_LABEL_KEYS,
  SHOW_FINDER_PATH,
  SHOW_FINDER_PITCH_PATH,
  SHOW_GENRE_PRESETS,
  SHOW_OPPORTUNITY_BLURB_KEYS,
  SHOW_OPPORTUNITY_LABEL_KEYS,
  SHOW_OPPORTUNITY_TYPES,
  buildGuestQuestionsPayload,
  buildShowFinderPayload,
  buildShowPitchPayload,
  guestQuestionsCost,
  guestQuestionsOf,
  guestQuestionsPlainText,
  showFinderCost,
  showFinderGenre,
  showFinderPitchCost,
  showOpportunitiesOf,
  showPitchOf,
  type GuestQuestionSection,
  type GuestQuestionsResult,
  type ShowOpportunity,
  type ShowOpportunityType,
  type ShowPitch,
} from "@/lib/world/live-benches";

const TYPE_ICON: Record<string, LucideIcon> = {
  "Open Mic": Mic2,
  Showcase: Trophy,
  Festival: PartyPopper,
  "Venue Gig": Building2,
  "Radio Spot": Radio,
  "Podcast Guest": Podcast,
};

const TYPE_KEY_ICON: Record<ShowOpportunityType, LucideIcon> = {
  "open-mic": Mic2,
  showcase: Trophy,
  festival: PartyPopper,
  "venue-gig": Building2,
  radio: Radio,
  podcast: Podcast,
};

const SECTION_ICON: Record<GuestQuestionSection, LucideIcon> = {
  warmup: Flame,
  deepDive: MessagesSquare,
  rapidFire: Zap,
  closer: Flag,
};

export function ShowFinderBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { profile, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [location, setLocation] = useState("");
  const [genre, setGenre] = useState("Hip-Hop");
  const [customGenre, setCustomGenre] = useState("");
  const [types, setTypes] = useState<ShowOpportunityType[]>(["open-mic", "showcase", "venue-gig"]);
  const [dateWindow, setDateWindow] = useState<string>("next-90-days");
  const [artistBio, setArtistBio] = useState("");
  const [creatorName, setCreatorName] = useState("");

  const [results, setResults] = useState<ShowOpportunity[] | null>(null);
  const [disclaimer, setDisclaimer] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const [pitchFor, setPitchFor] = useState<number | null>(null);
  const [pitch, setPitch] = useState<ShowPitch | null>(null);
  const [pitchTips, setPitchTips] = useState<string[]>([]);
  const [pitchLoading, setPitchLoading] = useState(false);
  const [pitchError, setPitchError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const cost = showFinderCost();
  const pitchCost = showFinderPitchCost();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";

  function toggleType(key: ShowOpportunityType) {
    setTypes((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  }

  async function findShows() {
    if (loading) return;
    if (!location.trim()) {
      setFormError(t("shows.errorNeedLocation"));
      return;
    }
    if (types.length === 0) {
      setFormError(t("shows.errorNeedTypes"));
      return;
    }
    if (!showFinderGenre({ genre, customGenre })) {
      setFormError(t("shows.errorNeedGenre"));
      return;
    }
    setLoading(true);
    setFormError(null);
    setLoadError(null);
    setOutOfCredits(false);
    setResults(null);
    setPitchFor(null);
    setPitch(null);
    try {
      const res = await confirmedFetch(SHOW_FINDER_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildShowFinderPayload({ location, genre, customGenre, opportunityTypes: types, dateWindow, artistBio }),
        ),
        overrideCost: cost,
        overrideFeature: "Show Finder",
      });
      if (!res) return; // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402 || (data as { error?: string } | null)?.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      const found = showOpportunitiesOf(data);
      if (!res.ok || !found) {
        throw new Error(apiErrorMessage(data, t("shows.errorSearchFailed")));
      }
      /* An empty result set is a SUCCESSFUL hunt that matched
         nothing — it renders the zero-match state, never
         "Show hunt failed." (The page's own ruling: the hunt
         is charged; calling a delivered empty answer a
         failure invites paying for the same hunt twice.) */
      setResults(found.opportunities);
      setDisclaimer(found.disclaimer);
      refreshProfile();
    } catch (err) {
      setLoadError(plainErrorText(err, t("shows.errorSearchFailed")));
    } finally {
      setLoading(false);
    }
  }

  async function draftPitch(index: number, opp: ShowOpportunity) {
    if (pitchLoading) return;
    setPitchFor(index);
    setPitch(null);
    setPitchTips([]);
    setPitchError(null);
    setPitchLoading(true);
    try {
      const res = await confirmedFetch(SHOW_FINDER_PITCH_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildShowPitchPayload({
            opportunity: opp,
            creatorName,
            profileName: profile?.display_name,
            genre,
            customGenre,
            artistBio,
            location,
          }),
        ),
        overrideCost: pitchCost,
        overrideFeature: "Show Pitch Draft",
      });
      if (!res) {
        setPitchFor(null);
        return; // spend confirmation declined — nothing ran
      }
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402 || (data as { error?: string } | null)?.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        setPitchFor(null);
        return;
      }
      const drafted = showPitchOf(data);
      if (!res.ok || !drafted) {
        throw new Error(apiErrorMessage(data, t("shows.errorPitchFailed")));
      }
      setPitch(drafted.pitch);
      setPitchTips(drafted.tips);
      refreshProfile();
    } catch (err) {
      setPitchError(plainErrorText(err, t("shows.errorPitchFailed")));
    } finally {
      setPitchLoading(false);
    }
  }

  function copyPitch() {
    if (!pitch) return;
    void navigator.clipboard
      .writeText(`Subject: ${pitch.subject}\n\n${pitch.body}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  }

  const chipCls = (active: boolean) =>
    `rounded-xl border px-3 py-2 text-left text-xs transition bdv-touch-target ${
      active
        ? isLight
          ? "border-[#C9A84C] bg-[#F7ECD2] text-[#2a1e07]"
          : "border-amber-400 bg-amber-400/[0.16] text-amber-200"
        : isLight
          ? "border-[#C9A84C]/30 text-[#6B5B36] hover:border-[#C9A84C]/60"
          : "border-white/10 text-white/60 hover:border-white/30"
    }`;

  return (
    <div className="space-y-3" data-testid="world-show-finder-bench">
      <div className="flex items-center gap-2">
        <Ticket className={`h-4 w-4 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
        <p className={`text-base font-black ${strong}`}>
          {t("shows.titleStart")} {t("shows.titleAccent")}
        </p>
        <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
          {cost} VB
        </span>
      </div>
      <p className={`text-xs ${muted}`}>{t("shows.heroDescription")}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <DeskTextField
          isLight={isLight}
          label={t("shows.cityLabel")}
          value={location}
          onChange={setLocation}
          placeholder={t("shows.cityPlaceholder")}
        />
        <div>
          <DeskTextField
            isLight={isLight}
            label={t("shows.genreLabel")}
            value={customGenre}
            onChange={setCustomGenre}
            placeholder={genre}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SHOW_GENRE_PRESETS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => { setGenre(g); setCustomGenre(""); }}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition bdv-touch-target ${
                  !customGenre.trim() && genre === g
                    ? "bg-[#d4af37] text-black"
                    : isLight
                      ? "border border-[#C9A84C]/40 text-[#6B5B36]"
                      : "border border-white/10 text-white/50 hover:border-white/30"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <p className={`mb-2 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t("shows.huntingLabel")}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SHOW_OPPORTUNITY_TYPES.map((key) => {
            const Icon = TYPE_KEY_ICON[key];
            const selected = types.includes(key);
            return (
              <button key={key} type="button" onClick={() => toggleType(key)} className={chipCls(selected)}>
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span className="text-xs font-bold">{t(`shows.${SHOW_OPPORTUNITY_LABEL_KEYS[key]}`)}</span>
                </span>
                <span className={`mt-0.5 block text-[11px] ${muted}`}>
                  {t(`shows.${SHOW_OPPORTUNITY_BLURB_KEYS[key]}`)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className={`mb-2 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            <CalendarDays className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> {t("shows.dateWindowLabel")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SHOW_DATE_WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setDateWindow(w)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition bdv-touch-target ${
                  dateWindow === w
                    ? "bg-[#d4af37] text-black"
                    : isLight
                      ? "border border-[#C9A84C]/40 text-[#6B5B36]"
                      : "border border-white/10 text-white/60 hover:border-white/30"
                }`}
              >
                {t(`shows.${SHOW_DATE_WINDOW_LABEL_KEYS[w]}`)}
              </button>
            ))}
          </div>
        </div>
        <DeskTextField
          isLight={isLight}
          label={`${t("shows.artistNameLabel")} ${t("shows.forPitchesNote")}`}
          value={creatorName}
          onChange={setCreatorName}
          placeholder={t("shows.artistNamePlaceholder")}
        />
      </div>

      <label className="block">
        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t("shows.quickBioLabel")} <span className="normal-case tracking-normal opacity-70">{t("shows.quickBioNote")}</span>
        </span>
        <textarea
          aria-label={t("shows.bioPlaceholder")}
          value={artistBio}
          onChange={(e) => setArtistBio(e.target.value)}
          maxLength={600}
          rows={3}
          placeholder={t("shows.bioPlaceholder")}
          className={`${deskInputCls(isLight)} resize-none`}
        />
      </label>

      {formError && (
        <p className={`flex items-start gap-2 text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="world-show-finder-run"
          onClick={() => void findShows()}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {loading ? t("shows.huntingLoading") : t("shows.findStagesButton", { cost })}
        </button>
      </div>

      {outOfCredits && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {t("worldBenches300.outOfBucs", { feature: "Show Finder" })}
        </p>
      )}
      {loading && <NativeLoadingState isLight={isLight} message={t("shows.huntingLoading")} />}
      {loadError && !loading && (
        <NativeErrorState isLight={isLight} message={loadError} onRetry={() => void findShows()} />
      )}

      {results && !loading && (
        <div className="space-y-3" data-testid="world-show-finder-results">
          <p className={`text-sm font-black ${strong}`}>
            {t("shows.yourStages")} <span className="text-[#d4af37]">({results.length})</span>
          </p>
          {disclaimer && (
            <p className={`flex items-start gap-2 rounded-xl border p-3 text-xs leading-relaxed ${isLight ? "border-amber-600/40 bg-amber-100/60 text-[#6B5B36]" : "border-amber-500/30 bg-amber-500/10 text-amber-200/90"}`}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {disclaimer}
            </p>
          )}
          {results.length === 0 && (
            <NativeEmptyState isLight={isLight} message={t("shows.noMatches")} />
          )}
          {results.map((opp, i) => {
            const Icon = TYPE_ICON[opp.type] ?? Ticket;
            const pitching = pitchFor === i;
            return (
              <div key={i} className={`rounded-xl border p-3 ${cardCls}`}>
                <div className="flex items-start gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-[#d4af37]/40 bg-[#d4af37]/10"}`}>
                    <Icon className={`h-4 w-4 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} aria-hidden="true" />
                  </span>
                  <div>
                    <p className={`text-sm font-black ${strong}`}>{opp.title}</p>
                    <p className={`mt-0.5 text-[11px] font-semibold uppercase tracking-widest ${muted}`}>
                      {opp.type}
                      {opp.organizer && <span> · {opp.organizer}</span>}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  <p className={`flex items-center gap-2 ${muted}`}>
                    <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {opp.location || t("shows.locationTbd")}
                  </p>
                  <p className={`flex items-center gap-2 ${muted}`}>
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {opp.dateWindow || t("shows.dateTbd")}
                  </p>
                </div>
                <div className={`mt-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/30 bg-[#F7ECD2]/60" : "border-[#d4af37]/20 bg-[#d4af37]/[0.06]"}`}>
                  <p className={`text-[11px] font-bold uppercase tracking-widest ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("shows.whyFitLabel")}</p>
                  <p className={`mt-1 text-xs leading-relaxed ${strong}`}>{opp.whyFit}</p>
                </div>
                <p className={`mt-3 text-[11px] font-bold uppercase tracking-widest ${muted}`}>{t("shows.howToApplyLabel")}</p>
                <p className={`mt-1 text-xs leading-relaxed ${strong}`}>{opp.howToApply}</p>
                {opp.verifyNote && (
                  <p className={`mt-2 flex items-start gap-2 text-[11px] leading-relaxed ${isLight ? "text-[#92600a]" : "text-amber-200/70"}`}>
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                    {t("shows.verifyPrefix", { note: opp.verifyNote })}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => (pitching ? setPitchFor(null) : void draftPitch(i, opp))}
                  disabled={pitchLoading}
                  className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition disabled:opacity-50 bdv-touch-target ${
                    isLight
                      ? "border-[#C9A84C]/60 bg-[#F7ECD2] text-[#7A5A12] hover:bg-[#F1E3BC]"
                      : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a] hover:bg-[#d4af37]/20"
                  }`}
                >
                  {pitchLoading && pitching ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> {t("shows.draftingPitch")}
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      {pitching ? t("shows.hidePitchDraft") : t("shows.draftPitchButton", { cost: pitchCost })}
                    </>
                  )}
                </button>
                {pitching && (
                  <div className={`mt-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/30 bg-white/60" : "border-white/10 bg-black/40"}`}>
                    {pitchLoading && <NativeLoadingState isLight={isLight} message={t("shows.draftingPitch")} />}
                    {pitchError && !pitchLoading && (
                      <NativeErrorState isLight={isLight} message={pitchError} onRetry={() => void draftPitch(i, opp)} />
                    )}
                    {pitch && !pitchLoading && (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <p className={`text-xs font-bold ${strong}`}>
                            <span className={muted}>{t("shows.subjectLabel")} </span>
                            {pitch.subject}
                          </p>
                          <button
                            type="button"
                            onClick={copyPitch}
                            className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition bdv-touch-target ${
                              isLight ? "border-[#C9A84C]/40 text-[#7A5A12]" : "border-white/15 text-white/70 hover:border-[#d4af37]/50"
                            }`}
                          >
                            {copied ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
                            {copied ? t("shows.copiedLabel") : t("shows.copyButton")}
                          </button>
                        </div>
                        <p className={`mt-2 whitespace-pre-line text-xs leading-relaxed ${strong}`}>{pitch.body}</p>
                        {pitchTips.length > 0 && (
                          <div className={`mt-3 border-t pt-3 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
                            <p className={`text-[11px] font-bold uppercase tracking-widest ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                              {t("shows.sendItWith")}
                            </p>
                            <ul className="mt-2 space-y-1.5">
                              {pitchTips.map((tip, ti) => (
                                <li key={ti} className={`flex items-start gap-2 text-xs ${muted}`}>
                                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                                  {tip}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function GuestQuestionsBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [guestName, setGuestName] = useState("");
  const [topic, setTopic] = useState("");
  const [bio, setBio] = useState("");

  const [result, setResult] = useState<GuestQuestionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [copied, setCopied] = useState(false);

  const cost = guestQuestionsCost();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";

  async function generate() {
    if (loading) return;
    if (!guestName.trim()) {
      setFormError(t("podcast.guestQuestions.errors.guestRequired"));
      return;
    }
    if (!topic.trim()) {
      setFormError(t("podcast.guestQuestions.errors.topicRequired"));
      return;
    }
    setLoading(true);
    setFormError(null);
    setLoadError(null);
    setOutOfCredits(false);
    setResult(null);
    try {
      const res = await confirmedFetch(GUEST_QUESTIONS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildGuestQuestionsPayload({ guestName, topic, bio })),
        overrideCost: cost,
        overrideFeature: t("podcast.guestQuestions.form.title"),
      });
      if (!res) return; // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402 || (data as { error?: string } | null)?.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      const parsed = guestQuestionsOf(data);
      if (!res.ok || !parsed) {
        throw new Error(apiErrorMessage(data, t("podcast.guestQuestions.errors.generationFailed")));
      }
      setResult(parsed);
      refreshProfile();
    } catch (err) {
      setLoadError(plainErrorText(err, t("podcast.guestQuestions.errors.generationFailed")));
    } finally {
      setLoading(false);
    }
  }

  function plainText(): string {
    if (!result) return "";
    return guestQuestionsPlainText(result, {
      forGuest: t("podcast.guestQuestions.results.forGuest", { guest: result.guestName }),
      aboutTopic: t("podcast.guestQuestions.results.aboutTopic", { topic: result.topic }),
      sections: {
        warmup: t("podcast.guestQuestions.sections.warmup"),
        deepDive: t("podcast.guestQuestions.sections.deepDive"),
        rapidFire: t("podcast.guestQuestions.sections.rapidFire"),
        closer: t("podcast.guestQuestions.sections.closer"),
      },
      whyLabel: t("podcast.guestQuestions.sections.whyLabel"),
    });
  }

  function copyAll() {
    const text = plainText();
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setFormError(t("podcast.guestQuestions.errors.copyFailed")),
    );
  }

  function downloadTxt() {
    const text = plainText();
    if (!result || !text) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `guest-questions-${result.guestName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3" data-testid="world-guest-questions-bench">
      <div className="flex items-center gap-2">
        <MessagesSquare className={`h-4 w-4 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
        <p className={`text-base font-black ${strong}`}>{t("podcast.guestQuestions.form.title")}</p>
        <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
          {cost} VB
        </span>
      </div>
      <p className={`text-xs ${muted}`}>{t("podcast.guestQuestions.form.subtitle")}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <DeskTextField
          isLight={isLight}
          label={t("podcast.guestQuestions.form.guestNameLabel")}
          value={guestName}
          onChange={setGuestName}
          placeholder={t("podcast.guestQuestions.form.guestNamePh")}
        />
        <DeskTextField
          isLight={isLight}
          label={t("podcast.guestQuestions.form.topicLabel")}
          value={topic}
          onChange={setTopic}
          placeholder={t("podcast.guestQuestions.form.topicPh")}
        />
      </div>

      <label className="block">
        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t("podcast.guestQuestions.form.bioLabel")}
        </span>
        <textarea
          aria-label={t("podcast.guestQuestions.form.bioPh")}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          placeholder={t("podcast.guestQuestions.form.bioPh")}
          className={`${deskInputCls(isLight)} resize-none`}
        />
      </label>

      {!result && !loading && !loadError && (
        <NativeEmptyState isLight={isLight} message={t("podcast.guestQuestions.form.honestyNote")} />
      )}

      {formError && (
        <p className={`flex items-start gap-2 text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="world-guest-questions-run"
          onClick={() => void generate()}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? t("podcast.guestQuestions.form.generating") : `${t("podcast.guestQuestions.form.generate")} · ${cost} VB`}
        </button>
      </div>

      {outOfCredits && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {t("worldBenches300.outOfBucs", { feature: "Guest Questions" })}
        </p>
      )}
      {loading && <NativeLoadingState isLight={isLight} message={t("podcast.guestQuestions.form.generating")} />}
      {loadError && !loading && (
        <NativeErrorState isLight={isLight} message={loadError} onRetry={() => void generate()} />
      )}

      {result && !loading && (
        <div className="space-y-3" data-testid="world-guest-questions-result">
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <p className={`text-sm font-black ${strong}`}>
                {t("podcast.guestQuestions.results.forGuest", { guest: result.guestName })}
              </p>
              <p className={`text-xs ${muted}`}>
                {t("podcast.guestQuestions.results.aboutTopic", { topic: result.topic })} ·{" "}
                {t("podcast.guestQuestions.results.questionsCount", { count: result.total })}
              </p>
            </div>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={copyAll}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition bdv-touch-target ${
                  isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-white/15 text-white/70 hover:border-[#d4af37]/50"
                }`}
              >
                {copied ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
                {copied ? t("podcast.guestQuestions.results.copied") : t("podcast.guestQuestions.results.copyAll")}
              </button>
              <button
                type="button"
                onClick={downloadTxt}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition bdv-touch-target ${
                  isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-white/15 text-white/70 hover:border-[#d4af37]/50"
                }`}
              >
                <Download className="h-3 w-3" aria-hidden="true" /> {t("podcast.guestQuestions.results.downloadTxt")}
              </button>
            </div>
          </div>
          {result.creditsUsed !== null && result.creditsRemaining !== null && (
            <p className={`text-[11px] ${muted}`}>
              {t("podcast.guestQuestions.results.creditsNote", { used: result.creditsUsed, remaining: result.creditsRemaining })}
            </p>
          )}
          {GUEST_QUESTION_SECTIONS.map((key) => {
            const Icon = SECTION_ICON[key];
            const items = result[key];
            if (items.length === 0) return null;
            return (
              <div key={key} className={`rounded-xl border p-3 ${cardCls}`}>
                <p className={`flex items-center gap-2 text-xs font-black uppercase tracking-widest ${strong}`}>
                  <Icon className={`h-3.5 w-3.5 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} aria-hidden="true" />
                  {t(`podcast.guestQuestions.sections.${key}`)}
                </p>
                <ol className="mt-2 space-y-2">
                  {items.map((q, i) => (
                    <li key={i} className="text-xs leading-relaxed">
                      <span className={`font-semibold ${strong}`}>{i + 1}. {q.question}</span>
                      {q.why && (
                        <span className={`block ${muted}`}>
                          {t("podcast.guestQuestions.sections.whyLabel")}: {q.why}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
