import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Download, Loader2, Megaphone } from "lucide-react";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
import {
  ANNOUNCEMENT_TYPE_OPTIONS,
  PRESS_RELEASE_COST_VB,
  PRESS_RELEASE_FEATURE,
  PRESS_RELEASE_PATH,
  buildKitReleaseEntry,
  buildPressReleaseBody,
  formatReleaseText,
  parseGeneratedRelease,
  releaseTextStrings,
  pressReleaseReady,
  savedReleasesForKit,
  type GeneratedRelease,
  type PressReleaseForm,
} from "@/lib/world/press-release-writer";

/* ─── Press-release writer, in-world (stack1100 world parity) ──────
   The bench's last BUSINESS follow-on graduates into the Press Kit
   desk: the writer that shares the 2D press-kit page
   (components/PressReleasePanel.tsx), on the panel's own rails.
   Generate rides the credit confirmation (confirmedFetch with the
   registry's pinned 100 Bucs named up front — a cancel charges
   nothing), and the finished release reads, copies, downloads as
   .txt, and saves into the kit's press_releases through the page's
   own append chain (read the kit's real list off /api/press-kit/
   mine, PUT the extended list back — never an overwrite guessed
   from a summary that doesn't carry the releases).

   The desk around it already pitches guests; this section is a
   charged member tool and renders for members only. */

const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;

/* Announcement-type labels (stack100 locale unit 47): the seam's
   ANNOUNCEMENT_TYPE_OPTIONS stays the pinned English mirror; the
   desk renders the type names from the catalog by key. */
const TYPE_KEYS: Record<string, string> = {
  single: "worldSponsorPress.prTypeSingle",
  album: "worldSponsorPress.prTypeAlbum",
  tour: "worldSponsorPress.prTypeTour",
  launch: "worldSponsorPress.prTypeLaunch",
  milestone: "worldSponsorPress.prTypeMilestone",
};

export function PressReleaseWriter({
  isLight,
  kitId,
  artistNameSeed,
  onSavedToKit,
}: {
  isLight: boolean;
  /** The desk's loaded kit — null until one exists. Generating
   *  works either way; saving into the kit needs the kit. */
  kitId: string | null;
  artistNameSeed: string;
  onSavedToKit?: () => void;
}) {
  const { t } = useTranslation();
  const authHeaders = useDeskAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const [form, setForm] = useState<PressReleaseForm>({
    announcementType: "single",
    topic: "",
    artistName: artistNameSeed,
    keyFactsText: "",
    quote: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    datelineCity: "",
  });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [release, setRelease] = useState<GeneratedRelease | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const set = (patch: Partial<PressReleaseForm>) => setForm((f) => ({ ...f, ...patch }));

  async function generate() {
    if (!pressReleaseReady(form) || generating) return;
    setError(null);
    setOutOfCredits(false);
    setSavedNote(null);
    setGenerating(true);
    try {
      const res = await confirmedFetch(PRESS_RELEASE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        overrideCost: PRESS_RELEASE_COST_VB,
        overrideFeature: PRESS_RELEASE_FEATURE,
        body: JSON.stringify(buildPressReleaseBody(form)),
      });
      if (!res) return; // the member declined the credit confirmation — nothing charged
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) {
        setError(apiErrorMessage(data, t("worldSponsorPress.prErrorWrite")));
        return;
      }
      const parsed = parseGeneratedRelease(data);
      if (!parsed) {
        setError(t("worldSponsorPress.prErrorShape"));
        return;
      }
      setRelease(parsed);
    } catch (err) {
      setError(plainErrorText(err, t("worldSponsorPress.prErrorWrite")));
    } finally {
      setGenerating(false);
    }
  }

  function copyRelease() {
    if (!release) return;
    void navigator.clipboard
      ?.writeText(formatReleaseText(release, form.artistName.trim(), releaseTextStrings(t)))
      .catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadRelease() {
    if (!release) return;
    const slug =
      release.headline
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "press-release";
    const blob = new Blob([formatReleaseText(release, form.artistName.trim(), releaseTextStrings(t))], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function saveToKit() {
    if (!release || !kitId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const mineRes = await fetch("/api/press-kit/mine", { headers: await authHeaders() });
      if (!mineRes.ok) throw new Error("mine");
      const existing = savedReleasesForKit(await mineRes.json(), kitId);
      if (!existing) throw new Error("kit releases unreadable");
      const entry = buildKitReleaseEntry(release, form, new Date());
      const res = await fetch(`/api/press-kit/${kitId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ press_releases: [...existing, entry] }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldSponsorPress.prErrorSave")));
      setRelease(null);
      setSavedNote(t("worldSponsorPress.prSavedNote"));
      onSavedToKit?.();
    } catch (err) {
      setError(plainErrorText(err, t("worldSponsorPress.prErrorSaveLong")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="world-press-release-writer" className="space-y-3">
      <p className={`inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        <Megaphone className="h-4 w-4" /> {t("worldSponsorPress.prTitle")}
      </p>
      <p className={`text-sm ${muted}`}>
        {t("worldSponsorPress.prIntro", { cost: PRESS_RELEASE_COST_VB })}
      </p>

      <div className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          <select
            className={deskInputCls(isLight)}
            value={form.announcementType}
            onChange={(e) => set({ announcementType: e.target.value })}
            aria-label={t("press-kit.pressRelease.form.announcementType")}
          >
            {ANNOUNCEMENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {TYPE_KEYS[opt.key] ? t(TYPE_KEYS[opt.key]) : opt.label}
              </option>
            ))}
          </select>
          <input
            className={deskInputCls(isLight)}
            placeholder={t("worldSponsorPress.prDatelinePlaceholder")}
            maxLength={80}
            value={form.datelineCity}
            onChange={(e) => set({ datelineCity: e.target.value })}
            aria-label={t("press-kit.pressRelease.form.datelineCity")}
          />
        </div>
        <input
          className={deskInputCls(isLight)}
          placeholder={t("press-kit.pressRelease.form.artistName")}
          maxLength={120}
          value={form.artistName}
          onChange={(e) => set({ artistName: e.target.value })}
          aria-label={t("worldSponsorPress.prArtistAria")}
        />
        <textarea
          className={deskInputCls(isLight)}
          placeholder={t("worldSponsorPress.prTopicPlaceholder")}
          rows={3}
          maxLength={2000}
          value={form.topic}
          onChange={(e) => set({ topic: e.target.value })}
          aria-label={t("worldSponsorPress.prTopicAria")}
        />
        <textarea
          className={deskInputCls(isLight)}
          placeholder={t("worldSponsorPress.prKeyFactsPlaceholder")}
          rows={3}
          value={form.keyFactsText}
          onChange={(e) => set({ keyFactsText: e.target.value })}
          aria-label={t("worldSponsorPress.prKeyFactsAria")}
        />
        <textarea
          className={deskInputCls(isLight)}
          placeholder={t("worldSponsorPress.prQuotePlaceholder")}
          rows={2}
          maxLength={600}
          value={form.quote}
          onChange={(e) => set({ quote: e.target.value })}
          aria-label={t("worldSponsorPress.prQuoteAria")}
        />
        <div className="flex flex-wrap gap-2">
          <input
            className={deskInputCls(isLight)}
            placeholder={t("press-kit.pressRelease.form.contactName")}
            maxLength={120}
            value={form.contactName}
            onChange={(e) => set({ contactName: e.target.value })}
            aria-label={t("press-kit.pressRelease.form.contactName")}
          />
          <input
            className={deskInputCls(isLight)}
            placeholder={t("press-kit.pressRelease.form.contactEmail")}
            maxLength={160}
            value={form.contactEmail}
            onChange={(e) => set({ contactEmail: e.target.value })}
            aria-label={t("press-kit.pressRelease.form.contactEmail")}
          />
          <input
            className={deskInputCls(isLight)}
            placeholder={t("press-kit.pressRelease.form.contactPhone")}
            maxLength={40}
            value={form.contactPhone}
            onChange={(e) => set({ contactPhone: e.target.value })}
            aria-label={t("press-kit.pressRelease.form.contactPhone")}
          />
        </div>
      </div>

      {outOfCredits ? (
        <p className={`text-xs font-semibold ${strong}`}>
          {t("worldSponsorPress.prOutOfCredits", { cost: PRESS_RELEASE_COST_VB })}
        </p>
      ) : null}
      {error ? (
        <p className={`text-xs ${isLight ? "text-[#8a2f1b]" : "text-red-300"}`}>{error}</p>
      ) : null}
      {savedNote ? <p className={`text-xs font-semibold ${strong}`}>{savedNote}</p> : null}

      <button
        type="button"
        data-testid="world-press-release-generate"
        className={goldBtn}
        disabled={!pressReleaseReady(form) || generating}
        onClick={() => void generate()}
      >
        {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Megaphone className="h-3.5 w-3.5" />}
        {t("worldSponsorPress.prGenerateButton", { cost: PRESS_RELEASE_COST_VB })}
      </button>

      {release ? (
        <div
          data-testid="world-press-release-result"
          className={`space-y-2 rounded-xl border p-3 ${
            isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
          }`}
        >
          <p className={`text-base font-black ${strong}`}>{release.headline}</p>
          <p className={`text-sm ${strong}`}>
            {release.dateline ? `${release.dateline} — ` : ""}
            {release.lede}
          </p>
          {release.body.map((para, i) => (
            <p key={i} className={`text-sm ${muted}`}>
              {para}
            </p>
          ))}
          {release.quote ? (
            <p className={`text-sm italic ${strong}`}>
              “{release.quote}” — {form.artistName.trim()}
            </p>
          ) : null}
          {release.social ? (
            <p className={`text-xs ${muted}`}>
              <span className="font-bold">{t("worldSponsorPress.prSocialVersion")}</span> {release.social}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className={chipBtn(isLight)} onClick={copyRelease}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t("press-kit.pressRelease.copied") : t("worldSponsorPress.prCopyButton")}
            </button>
            <button type="button" className={chipBtn(isLight)} onClick={downloadRelease}>
              <Download className="h-3.5 w-3.5" /> {t("worldSponsorPress.prDownloadButton")}
            </button>
            {kitId ? (
              <button
                type="button"
                className={goldBtn}
                disabled={saving}
                onClick={() => void saveToKit()}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {t("worldSponsorPress.prSaveButton")}
              </button>
            ) : (
              <span className={`inline-flex items-center text-xs ${muted}`}>
                {t("worldSponsorPress.prNoKitNote")}
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
