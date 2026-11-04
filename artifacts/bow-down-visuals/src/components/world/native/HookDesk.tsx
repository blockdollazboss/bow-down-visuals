import { apiErrorMessage } from "../../../lib/api-error";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Gauge, Loader2, Megaphone, MousePointerClick, ScrollText, Sparkles, Type, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { DeskSelectField, DeskTextField } from "./CreateDeskLeaf";
import type { CreateDeskProps } from "./CreateDesks";
import { parsePanelPayloadFor } from "@/lib/world/panel-payload";
import { HOOK_TEMPLATES } from "@/data/hook-templates";
import { CAPTION_PACKS } from "@/data/caption-templates";
import {
  CAPTION_PLATFORMS,
  CTA_GOALS,
  CTA_PLATFORMS,
  HOOK_DESK_STATION_ID,
  HOOK_VIDEO_TYPES,
  SCRIPT_LENGTHS,
  SCRIPT_PLATFORMS,
  SCRIPT_TONES,
  TITLE_PLATFORMS,
  TITLE_TONES,
  captionPackPrefill,
  buildCaptionPayload,
  buildCtaPayload,
  buildHookPayload,
  buildPreflightPayload,
  buildScriptPayload,
  buildTitlePayload,
  captionsOfResponse,
  ctasOfResponse,
  hookDeskInputReady,
  hookDeskModeCost,
  hookDeskModePath,
  hookTemplatePrefill,
  hooksOfResponse,
  preflightOfResponse,
  pushHookHistory,
  scriptOfResponse,
  titlesOfResponse,
  type CaptionPlatform,
  type CaptionResult,
  type CtaGoal,
  type CtaPlatform,
  type CtaResult,
  type HookDeskMode,
  type HookHistoryEntry,
  type HookVideoType,
  type PreflightResult,
  type ScriptLength,
  type ScriptPlatform,
  type ScriptResult,
  type ScriptTone,
  type TitlePlatform,
  type TitleTone,
  type TitlesResult,
} from "@/lib/world/hook-desk";

/* ─── The Hook Desk (Stack-100 item 97, closing part) ───────────────
   Hook Studio, native in the Create Wing: the 2D /hooks page's own
   money modes on its own rails —
     Hooks      POST /api/hook-studio {mode:"hooks"}     100 VB
     Captions   POST /api/hook-studio {mode:"captions"}  100 VB
     Pre-flight POST /api/hook-studio {mode:"preflight"} 100 VB
     CTAs       POST /api/generate-cta                    50 VB
     Titles     POST /api/title-studio                  100 VB
     Scripts    POST /api/script-writer                 200 VB
   (Titles + Scripts: Stack-100 item 30 [B6] — the /hooks Titles
   tab and the /script-writer page, same posts, same prices.)
   Every run rides confirmedFetch (the registry-priced spend
   confirmation stands before anything runs; a decline runs
   nothing) and the price is printed on the desk before the run.
   A failed generation is refunded server-side; a 402 reads as
   out-of-Visual-Bucs, never as a mystery. The site's hook
   templates + caption packs prefill the desk (free — picking one
   charges nothing), and this session's makes stay on the desk's
   history strip. Results render IN the panel with copy buttons —
   nothing here ejects to the website. This is the desk Daily
   Drop hook/caption "Use" opens (item 97 closed in full). */

const MODES: ReadonlyArray<{ key: HookDeskMode; labelKey: string; icon: LucideIcon }> = [
  { key: "hooks", labelKey: "worldCreateMedia.hookModeHooks", icon: Zap },
  { key: "captions", labelKey: "worldCreateMedia.hookModeCaptions", icon: Megaphone },
  { key: "preflight", labelKey: "worldCreateMedia.hookModePreflight", icon: Gauge },
  { key: "cta", labelKey: "worldCreateMedia.hookModeCtas", icon: MousePointerClick },
  { key: "titles", labelKey: "worldCreateMedia.hookModeTitles", icon: Type },
  { key: "scripts", labelKey: "worldCreateMedia.hookModeScripts", icon: ScrollText },
];

const RUN_LABEL_KEY: Record<HookDeskMode, string> = {
  hooks: "worldCreateMedia.hookRunHooks",
  captions: "worldCreateMedia.hookRunCaptions",
  preflight: "worldCreateMedia.hookRunPreflight",
  cta: "worldCreateMedia.hookRunCtas",
  titles: "worldCreateMedia.hookRunTitles",
  scripts: "worldCreateMedia.hookRunScripts",
};

function CopyLine({ text, isLight }: { text: string; isLight: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-start gap-2">
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        aria-label={t("worldCreateMedia.hookCopyLabel")}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }).catch(() => {});
        }}
        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold bdv-touch-box ${
          isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/70"
        }`}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

export function HookDesk(props: CreateDeskProps) {
  const { isLight } = props;
  const { t, i18n } = useTranslation();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [mode, setMode] = useState<HookDeskMode>("hooks");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* hooks + captions + cta share the topic field (the page's tabs
     each keep their own; the desk keeps one per mode family so a
     typed topic survives a mode switch inside the same family). */
  const [topic, setTopic] = useState("");
  const [videoType, setVideoType] = useState<HookVideoType>("music-promo");
  const [capPlatform, setCapPlatform] = useState<CaptionPlatform>("tiktok");
  const [capTone, setCapTone] = useState("");
  /* preflight */
  const [pfTitle, setPfTitle] = useState("");
  const [pfCaption, setPfCaption] = useState("");
  const [pfHashtags, setPfHashtags] = useState("");
  const [pfDescription, setPfDescription] = useState("");
  /* cta */
  const [ctaGoal, setCtaGoal] = useState<CtaGoal>("subscribe");
  const [ctaPlatform, setCtaPlatform] = useState<CtaPlatform>("tiktok");
  const [ctaTone, setCtaTone] = useState("");
  /* titles — the bench keeps its own topic, like the 2D tab keeps
     its own apart from the hooks tabs. */
  const [tsTopic, setTsTopic] = useState("");
  const [tsPlatform, setTsPlatform] = useState<TitlePlatform>("youtube");
  const [tsTone, setTsTone] = useState<TitleTone>("hype");
  const [tsKeywords, setTsKeywords] = useState("");
  /* scripts — the /script-writer page's own form, its own topic. */
  const [swTopic, setSwTopic] = useState("");
  const [swPlatform, setSwPlatform] = useState<ScriptPlatform>("youtube");
  const [swLength, setSwLength] = useState<ScriptLength>("medium");
  const [swTone, setSwTone] = useState<ScriptTone>("educational");
  const [swAudience, setSwAudience] = useState("");
  const [swCtaGoal, setSwCtaGoal] = useState("");

  const [hooks, setHooks] = useState<string[] | null>(null);
  const [captionResult, setCaptionResult] = useState<CaptionResult | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [ctas, setCtas] = useState<CtaResult[] | null>(null);
  const [titlesResult, setTitlesResult] = useState<TitlesResult | null>(null);
  const [scriptResult, setScriptResult] = useState<ScriptResult | null>(null);
  const [history, setHistory] = useState<HookHistoryEntry[]>([]);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const cost = hookDeskModeCost(mode);
  const activeTopic = mode === "titles" ? tsTopic : mode === "scripts" ? swTopic : topic;
  const ready = hookDeskInputReady(mode, { topic: activeTopic, title: pfTitle });

  const switchMode = (next: HookDeskMode) => {
    setMode(next);
    setNote(null);
    setOutOfCredits(false);
  };

  const applyHookTemplate = (slug: string) => {
    const pre = hookTemplatePrefill(slug);
    if (!pre) return;
    setVideoType(pre.videoType);
    setTopic(pre.topic);
    setNote(null);
  };

  const applyCaptionPack = (slug: string) => {
    const pre = captionPackPrefill(slug);
    if (!pre) return;
    setTopic(pre.topic);
    setCapPlatform(pre.platform);
    setCapTone(pre.tone);
    setNote(null);
  };

  /* Panel payload (Stack-100 #2 item 97): a handoff that named a
     template — a Daily Drop hook/caption "Use" — opens this desk
     PREFILLED with it, in the matching mode. Parsed defensively
     for THIS station only, applied once on open; anything else
     (absent, another desk's payload, an unknown slug) leaves the
     desk exactly as blank as a plain open. Prefilling is free —
     only a generation run charges, as ever. */
  const payloadAppliedRef = useRef(false);
  useEffect(() => {
    if (payloadAppliedRef.current) return;
    payloadAppliedRef.current = true;
    const payload = parsePanelPayloadFor(HOOK_DESK_STATION_ID, props.panelPayload);
    if (!payload) return;
    if (payload.kind === "hook-template") {
      setMode("hooks");
      applyHookTemplate(payload.templateSlug);
    } else if (payload.kind === "caption-pack") {
      setMode("captions");
      applyCaptionPack(payload.templateSlug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setNote(null);
    setOutOfCredits(false);
    try {
      const path = hookDeskModePath(mode);
      const body =
        mode === "hooks"
          ? buildHookPayload(videoType, topic)
          : mode === "captions"
            ? buildCaptionPayload({ topic, platform: capPlatform, tone: capTone })
            : mode === "preflight"
              ? buildPreflightPayload({ title: pfTitle, caption: pfCaption, hashtags: pfHashtags, description: pfDescription })
              : mode === "titles"
                ? buildTitlePayload({ topic: tsTopic, platform: tsPlatform, tone: tsTone, keywords: tsKeywords })
                : mode === "scripts"
                  ? buildScriptPayload({ platform: swPlatform, length: swLength, topic: swTopic, tone: swTone, audience: swAudience, ctaGoal: swCtaGoal })
                  : buildCtaPayload({ videoTopic: topic, ctaGoal, platform: ctaPlatform, tone: ctaTone });
      const res = await confirmedFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res) return; // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok) {
        const d = data as { message?: string; error?: string };
        setNote(apiErrorMessage(d, t("worldCreateMedia.hookHiccup")));
        return;
      }
      /* Shape-guard the answer: a body that drifts is a failed
         make (refunded server-side), never rows dressed as a win. */
      if (mode === "hooks") {
        const parsed = hooksOfResponse(data);
        if (!parsed) { setNote(t("worldCreateMedia.hookEmptyHooks")); return; }
        setHooks(parsed);
        setHistory((h) => pushHookHistory(h, { mode, label: topic.trim() || t("worldCreateMedia.hookModeHooks"), lines: parsed }));
      } else if (mode === "captions") {
        const parsed = captionsOfResponse(data);
        if (!parsed) { setNote(t("worldCreateMedia.hookEmptyCaptions")); return; }
        setCaptionResult(parsed);
        setHistory((h) => pushHookHistory(h, { mode, label: topic.trim(), lines: parsed.captions, captionResult: parsed }));
      } else if (mode === "preflight") {
        const parsed = preflightOfResponse(data);
        if (!parsed) { setNote(t("worldCreateMedia.hookEmptyScorecard")); return; }
        setPreflight(parsed);
        setHistory((h) => pushHookHistory(h, { mode, label: pfTitle.trim(), lines: [`${parsed.score}/100 — ${parsed.verdict}`], preflight: parsed }));
      } else if (mode === "titles") {
        const parsed = titlesOfResponse(data);
        if (!parsed) { setNote(t("worldJoinSweep.tsbEmptyTitles")); return; }
        setTitlesResult(parsed);
        setHistory((h) => pushHookHistory(h, { mode, label: tsTopic.trim(), lines: parsed.titles.map((t) => t.title), titlesResult: parsed }));
      } else if (mode === "scripts") {
        const parsed = scriptOfResponse(data);
        if (!parsed) { setNote(t("worldJoinSweep.tsbEmptyScript")); return; }
        setScriptResult(parsed);
        setHistory((h) => pushHookHistory(h, { mode, label: swTopic.trim(), lines: parsed.beats.map((b) => b.spoken), scriptResult: parsed }));
      } else {
        const parsed = ctasOfResponse(data);
        if (!parsed) { setNote(t("worldCreateMedia.hookEmptyCtas")); return; }
        setCtas(parsed);
        setHistory((h) => pushHookHistory(h, { mode, label: topic.trim(), lines: parsed.map((c) => c.text), ctas: parsed }));
      }
      refreshProfile();
    } catch {
      setNote(t("worldCreateMedia.hookHiccup"));
    } finally {
      setBusy(false);
    }
  };

  const restoreHistory = (entry: HookHistoryEntry) => {
    switchMode(entry.mode);
    if (entry.mode === "hooks") setHooks(entry.lines);
    if (entry.mode === "captions") setCaptionResult(entry.captionResult ?? { captions: entry.lines, hashtags: { niche: [], broad: [], trending: [] }, cta: "" });
    if (entry.mode === "cta" && entry.ctas) setCtas(entry.ctas);
    if (entry.mode === "preflight" && entry.preflight) setPreflight(entry.preflight);
    if (entry.mode === "titles" && entry.titlesResult) setTitlesResult(entry.titlesResult);
    if (entry.mode === "scripts" && entry.scriptResult) setScriptResult(entry.scriptResult);
  };

  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;

  return (
    <div className="space-y-3" data-testid="world-create-hook-desk">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("worldCreateMedia.hookToolsLabel")}>
        {MODES.map(({ key, labelKey, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            data-testid={`world-hook-desk-mode-${key}`}
            onClick={() => switchMode(key)}
            className={chipCls(mode === key)}
          >
            <Icon className="h-3.5 w-3.5" /> {t(labelKey)}
          </button>
        ))}
      </div>

      {mode === "hooks" && (
        <div className="space-y-3">
          <DeskSelectField
            isLight={isLight}
            label={t("worldCreateMedia.hookTemplateLabel")}
            value=""
            onChange={applyHookTemplate}
            options={[
              { value: "", label: t("worldCreateMedia.hookPickTemplate") },
              ...HOOK_TEMPLATES.map((tpl) => ({ value: tpl.slug, label: tpl.title })),
            ]}
          />
          <DeskSelectField
            isLight={isLight}
            label={t("worldCreateMedia.hookVideoType")}
            value={videoType}
            onChange={(v) => setVideoType(v as HookVideoType)}
            options={HOOK_VIDEO_TYPES.map((v) => ({ value: v, label: v }))}
          />
          <DeskTextField isLight={isLight} label={t("worldCreateMedia.hookTopicOptional")} value={topic} onChange={setTopic} placeholder={t("worldCreateMedia.hookTopicPlaceholder")} />
        </div>
      )}

      {mode === "captions" && (
        <div className="space-y-3">
          <DeskSelectField
            isLight={isLight}
            label={t("worldCreateMedia.hookCaptionPackLabel")}
            value=""
            onChange={applyCaptionPack}
            options={[
              { value: "", label: t("worldCreateMedia.hookPickPack") },
              ...CAPTION_PACKS.map((p) => ({ value: p.slug, label: p.title })),
            ]}
          />
          <DeskTextField isLight={isLight} label={t("worldCreateMedia.hookPostAbout")} value={topic} onChange={setTopic} />
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskSelectField
              isLight={isLight}
              label={t("worldCreateMedia.hookPlatform")}
              value={capPlatform}
              onChange={(v) => setCapPlatform(v as CaptionPlatform)}
              options={CAPTION_PLATFORMS.map((p) => ({ value: p, label: p }))}
            />
            <DeskTextField isLight={isLight} label={t("worldCreateMedia.hookToneOptional")} value={capTone} onChange={setCapTone} />
          </div>
        </div>
      )}

      {mode === "preflight" && (
        <div className="space-y-3">
          <DeskTextField isLight={isLight} label={t("worldCreateMedia.hookVideoTitle")} value={pfTitle} onChange={setPfTitle} />
          <DeskTextField isLight={isLight} label={t("worldCreateMedia.hookCaptionOptional")} value={pfCaption} onChange={setPfCaption} />
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskTextField isLight={isLight} label={t("worldCreateMedia.hookHashtagsOptional")} value={pfHashtags} onChange={setPfHashtags} />
            <DeskTextField isLight={isLight} label={t("worldCreateMedia.hookDescriptionOptional")} value={pfDescription} onChange={setPfDescription} />
          </div>
          <p className={`text-xs ${muted}`}>
            {t("worldCreateMedia.hookReadinessNote")}
          </p>
        </div>
      )}

      {mode === "cta" && (
        <div className="space-y-3">
          <DeskTextField isLight={isLight} label={t("worldCreateMedia.hookVideoAbout")} value={topic} onChange={setTopic} />
          <div className="grid gap-3 sm:grid-cols-3">
            <DeskSelectField
              isLight={isLight}
              label={t("worldCreateMedia.hookGoal")}
              value={ctaGoal}
              onChange={(v) => setCtaGoal(v as CtaGoal)}
              options={CTA_GOALS.map((g) => ({ value: g, label: g }))}
            />
            <DeskSelectField
              isLight={isLight}
              label={t("worldCreateMedia.hookPlatform")}
              value={ctaPlatform}
              onChange={(v) => setCtaPlatform(v as CtaPlatform)}
              options={CTA_PLATFORMS.map((p) => ({ value: p, label: p }))}
            />
            <DeskTextField isLight={isLight} label={t("worldCreateMedia.hookToneOptional")} value={ctaTone} onChange={setCtaTone} />
          </div>
        </div>
      )}

      {mode === "titles" && (
        <div className="space-y-3">
          <DeskTextField isLight={isLight} label={t("worldJoinSweep.tsbTopicLabel")} value={tsTopic} onChange={setTsTopic} />
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskSelectField
              isLight={isLight}
              label={t("worldJoinSweep.tsbPlatformLabel")}
              value={tsPlatform}
              onChange={(v) => setTsPlatform(v as TitlePlatform)}
              options={TITLE_PLATFORMS.map((p) => ({ value: p, label: p }))}
            />
            <DeskSelectField
              isLight={isLight}
              label={t("worldJoinSweep.tsbToneLabel")}
              value={tsTone}
              onChange={(v) => setTsTone(v as TitleTone)}
              options={TITLE_TONES.map((t) => ({ value: t, label: t }))}
            />
          </div>
          <DeskTextField isLight={isLight} label={t("worldJoinSweep.tsbKeywordsLabel")} value={tsKeywords} onChange={setTsKeywords} />
          <p className={`text-xs ${muted}`}>
            {t("worldJoinSweep.tsbTitlesNote")}
          </p>
        </div>
      )}

      {mode === "scripts" && (
        <div className="space-y-3">
          <DeskTextField isLight={isLight} label={t("worldJoinSweep.tsbTopicLabel")} value={swTopic} onChange={setSwTopic} />
          <div className="grid gap-3 sm:grid-cols-3">
            <DeskSelectField
              isLight={isLight}
              label={t("worldJoinSweep.tsbPlatformLabel")}
              value={swPlatform}
              onChange={(v) => setSwPlatform(v as ScriptPlatform)}
              options={SCRIPT_PLATFORMS.map((p) => ({ value: p, label: p }))}
            />
            <DeskSelectField
              isLight={isLight}
              label={t("worldJoinSweep.tsbLengthLabel")}
              value={swLength}
              onChange={(v) => setSwLength(v as ScriptLength)}
              options={SCRIPT_LENGTHS.map((l) => ({ value: l, label: l }))}
            />
            <DeskSelectField
              isLight={isLight}
              label={t("worldJoinSweep.tsbToneLabel")}
              value={swTone}
              onChange={(v) => setSwTone(v as ScriptTone)}
              options={SCRIPT_TONES.map((t) => ({ value: t, label: t }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskTextField isLight={isLight} label={t("worldJoinSweep.tsbAudienceLabel")} value={swAudience} onChange={setSwAudience} />
            <DeskTextField isLight={isLight} label={t("worldJoinSweep.tsbCtaGoalLabel")} value={swCtaGoal} onChange={setSwCtaGoal} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span data-testid="world-hook-desk-cost" className={`text-xs font-semibold ${muted}`}>
          {t("worldCreateMedia.hookCostLine", { cost: cost.toLocaleString(i18n.language) })}
        </span>
        <button
          type="button"
          data-testid="world-hook-desk-run"
          onClick={() => void run()}
          disabled={busy || !ready}
          className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? t("worldCreateMedia.hookWriting") : t(RUN_LABEL_KEY[mode])}
        </button>
      </div>
      {!ready && mode !== "hooks" && (
        <p className={`text-xs ${muted}`}>
          {mode === "preflight" ? t("worldCreateMedia.hookNeedTitle") : t("worldCreateMedia.hookNeedTopic")}
        </p>
      )}
      {outOfCredits && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {t("worldCreateMedia.hookOutOfBucs")}
        </p>
      )}
      {note && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}

      {mode === "hooks" && hooks && (
        <div data-testid="world-hook-desk-result" className="space-y-2">
          {hooks.map((h, i) => (
            <p key={i} className={`rounded-xl border px-3 py-2 text-sm ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
              <CopyLine text={h} isLight={isLight} />
            </p>
          ))}
        </div>
      )}

      {mode === "captions" && captionResult && (
        <div data-testid="world-hook-desk-result" className="space-y-3">
          {captionResult.captions.map((c, i) => (
            <p key={i} className={`whitespace-pre-line rounded-xl border px-3 py-2 text-sm ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
              <CopyLine text={c} isLight={isLight} />
            </p>
          ))}
          {(["niche", "broad", "trending"] as const).map((tier) =>
            captionResult.hashtags[tier].length > 0 ? (
              <p key={tier} className={`text-xs ${muted}`}>
                <span className="font-black uppercase tracking-[0.12em]">{tier}: </span>
                {captionResult.hashtags[tier].map((tag) => `#${tag}`).join(" ")}
              </p>
            ) : null,
          )}
          {captionResult.cta && (
            <p className={`text-sm font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {t("worldCreateMedia.hookCtaLine", { cta: captionResult.cta })}
            </p>
          )}
        </div>
      )}

      {mode === "preflight" && preflight && (
        <div data-testid="world-hook-desk-result" className="space-y-2">
          <p className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
            {t("worldCreateMedia.hookReadinessLine", { score: preflight.score })}{preflight.verdict ? ` — ${preflight.verdict}` : ""}
          </p>
          {preflight.checks.map((c) => (
            <div key={c.label} className={`rounded-xl border px-3 py-2 text-sm ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
              <p className="font-bold">{c.label} · {c.score}/100</p>
              <p className={muted}>{c.fix}</p>
            </div>
          ))}
          {preflight.disclaimer && <p className={`text-xs italic ${muted}`}>{preflight.disclaimer}</p>}
        </div>
      )}

      {mode === "cta" && ctas && (
        <div data-testid="world-hook-desk-result" className="space-y-2">
          {ctas.map((c, i) => (
            <p key={i} className={`rounded-xl border px-3 py-2 text-sm ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
              <CopyLine text={c.text} isLight={isLight} />
              <span className={`mt-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                {c.placement}{c.strength > 0 ? t("worldCreateMedia.hookStrengthSuffix", { strength: c.strength }) : ""}
              </span>
            </p>
          ))}
        </div>
      )}

      {mode === "titles" && titlesResult && (
        <div data-testid="world-hook-desk-result" className="space-y-2">
          {titlesResult.titles.map((title, i) => (
            <div key={i} className={`rounded-xl border px-3 py-2 text-sm ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
              <CopyLine text={title.title} isLight={isLight} />
              <span className={`mt-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>
                {t("worldJoinSweep.tsbReadinessLine", { rank: i + 1, score: title.score })}
              </span>
              {title.why && <p className={muted}>{title.why}</p>}
            </div>
          ))}
          <div className={`rounded-xl border px-3 py-2 text-sm ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
            <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldJoinSweep.tsbDescriptionLabel")}</p>
            <p className="whitespace-pre-line">{titlesResult.description}</p>
          </div>
          {titlesResult.tags.length > 0 && (
            <p className={`text-xs ${muted}`}>
              <span className="font-black uppercase tracking-[0.12em]">{t("worldJoinSweep.tsbTagsLabel")}</span>
              {titlesResult.tags.map((tag) => `#${tag}`).join(" ")}
            </p>
          )}
          {titlesResult.note && <p className={`text-xs italic ${muted}`}>{titlesResult.note}</p>}
        </div>
      )}

      {mode === "scripts" && scriptResult && (
        <div data-testid="world-hook-desk-result" className="space-y-2">
          {scriptResult.title && (
            <p className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{scriptResult.title}</p>
          )}
          <div className={`rounded-xl border px-3 py-2 text-sm ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
            <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldJoinSweep.tsbHookLabel")}</p>
            <CopyLine text={scriptResult.hook} isLight={isLight} />
          </div>
          {scriptResult.beats.map((b, i) => (
            <div key={i} className={`rounded-xl border px-3 py-2 text-sm ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
              <p>
                <span className="mr-2 font-bold">{b.timestamp}</span>
                <CopyLine text={b.spoken} isLight={isLight} />
              </p>
              {b.visualCue && <p className={muted}>{t("worldJoinSweep.tsbOnScreenLine", { cue: b.visualCue })}</p>}
              {b.broll && <p className={muted}>{t("worldJoinSweep.tsbBrollLine", { broll: b.broll })}</p>}
            </div>
          ))}
          {scriptResult.retentionBeats.length > 0 && (
            <div className={`rounded-xl border px-3 py-2 text-sm ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
              <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldJoinSweep.tsbRetentionLabel")}</p>
              {scriptResult.retentionBeats.map((r, i) => (
                <p key={i}>
                  <span className="font-bold">{r.at}</span>
                  {r.tactic ? <span className={muted}> · {r.tactic}</span> : null} — {r.line}
                </p>
              ))}
            </div>
          )}
          {scriptResult.cta && (
            <p className={`text-sm font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {t("worldJoinSweep.tsbCtaLine", { cta: scriptResult.cta })}
            </p>
          )}
          {scriptResult.teleprompter && (
            <div className={`rounded-xl border px-3 py-2 text-sm ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
              <p className={`mb-1 text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldJoinSweep.tsbTeleprompterLabel")}</p>
              <p className="whitespace-pre-line">
                <CopyLine text={scriptResult.teleprompter} isLight={isLight} />
              </p>
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div>
          <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("worldCreateMedia.hookThisSession")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {history.map((entry, i) => (
              <button
                key={`${entry.mode}-${entry.label}-${i}`}
                type="button"
                onClick={() => restoreHistory(entry)}
                className={chipCls(mode === entry.mode)}
              >
                {entry.mode}: {entry.label || t("worldCreateMedia.hookMakeFallback")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
