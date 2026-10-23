import { useEffect, useRef, useState } from "react";
import { Check, Copy, Gauge, Loader2, Megaphone, MousePointerClick, Sparkles, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { DeskSelectField, DeskTextField } from "./CreateDeskShared";
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
  captionPackPrefill,
  buildCaptionPayload,
  buildCtaPayload,
  buildHookPayload,
  buildPreflightPayload,
  captionsOfResponse,
  ctasOfResponse,
  hookDeskInputReady,
  hookDeskModeCost,
  hookDeskModePath,
  hookTemplatePrefill,
  hooksOfResponse,
  preflightOfResponse,
  pushHookHistory,
  type CaptionPlatform,
  type CaptionResult,
  type CtaGoal,
  type CtaPlatform,
  type CtaResult,
  type HookDeskMode,
  type HookHistoryEntry,
  type HookVideoType,
  type PreflightResult,
} from "@/lib/world/hook-desk";

/* ─── The Hook Desk (Stack-100 item 97, closing part) ───────────────
   Hook Studio, native in the Create Wing: the 2D /hooks page's own
   four money modes on its own two rails —
     Hooks      POST /api/hook-studio {mode:"hooks"}     100 VB
     Captions   POST /api/hook-studio {mode:"captions"}  100 VB
     Pre-flight POST /api/hook-studio {mode:"preflight"} 100 VB
     CTAs       POST /api/generate-cta                    50 VB
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

const MODES: ReadonlyArray<{ key: HookDeskMode; label: string; icon: LucideIcon }> = [
  { key: "hooks", label: "Hooks", icon: Zap },
  { key: "captions", label: "Captions", icon: Megaphone },
  { key: "preflight", label: "Pre-flight", icon: Gauge },
  { key: "cta", label: "CTAs", icon: MousePointerClick },
];

const RUN_LABEL: Record<HookDeskMode, string> = {
  hooks: "Write the hooks",
  captions: "Write the captions",
  preflight: "Score my post",
  cta: "Write the CTAs",
};

function CopyLine({ text, isLight }: { text: string; isLight: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-start gap-2">
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }).catch(() => {});
        }}
        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
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

  const [hooks, setHooks] = useState<string[] | null>(null);
  const [captionResult, setCaptionResult] = useState<CaptionResult | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [ctas, setCtas] = useState<CtaResult[] | null>(null);
  const [history, setHistory] = useState<HookHistoryEntry[]>([]);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const cost = hookDeskModeCost(mode);
  const ready = hookDeskInputReady(mode, { topic, title: pfTitle });

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
        setNote(d.message ?? d.error ?? "The studio hiccupped — a failed make is refunded. Try again.");
        return;
      }
      /* Shape-guard the answer: a body that drifts is a failed
         make (refunded server-side), never rows dressed as a win. */
      if (mode === "hooks") {
        const parsed = hooksOfResponse(data);
        if (!parsed) { setNote("The hooks came back empty — a failed make is refunded. Try again."); return; }
        setHooks(parsed);
        setHistory((h) => pushHookHistory(h, { mode, label: topic.trim() || "Hooks", lines: parsed }));
      } else if (mode === "captions") {
        const parsed = captionsOfResponse(data);
        if (!parsed) { setNote("The captions came back empty — a failed make is refunded. Try again."); return; }
        setCaptionResult(parsed);
        setHistory((h) => pushHookHistory(h, { mode, label: topic.trim(), lines: parsed.captions, captionResult: parsed }));
      } else if (mode === "preflight") {
        const parsed = preflightOfResponse(data);
        if (!parsed) { setNote("The scorecard came back empty — a failed make is refunded. Try again."); return; }
        setPreflight(parsed);
        setHistory((h) => pushHookHistory(h, { mode, label: pfTitle.trim(), lines: [`${parsed.score}/100 — ${parsed.verdict}`], preflight: parsed }));
      } else {
        const parsed = ctasOfResponse(data);
        if (!parsed) { setNote("The CTAs came back empty — a failed make is refunded. Try again."); return; }
        setCtas(parsed);
        setHistory((h) => pushHookHistory(h, { mode, label: topic.trim(), lines: parsed.map((c) => c.text), ctas: parsed }));
      }
      refreshProfile();
    } catch {
      setNote("The studio hiccupped — a failed make is refunded. Try again.");
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
  };

  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;

  return (
    <div className="space-y-3" data-testid="world-create-hook-desk">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Hook Desk tools">
        {MODES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            data-testid={`world-hook-desk-mode-${key}`}
            onClick={() => switchMode(key)}
            className={chipCls(mode === key)}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {mode === "hooks" && (
        <div className="space-y-3">
          <DeskSelectField
            isLight={isLight}
            label="Template (free — fills the desk)"
            value=""
            onChange={applyHookTemplate}
            options={[
              { value: "", label: "Pick a hook template…" },
              ...HOOK_TEMPLATES.map((tpl) => ({ value: tpl.slug, label: tpl.title })),
            ]}
          />
          <DeskSelectField
            isLight={isLight}
            label="Video type"
            value={videoType}
            onChange={(v) => setVideoType(v as HookVideoType)}
            options={HOOK_VIDEO_TYPES.map((v) => ({ value: v, label: v }))}
          />
          <DeskTextField isLight={isLight} label="Topic (optional)" value={topic} onChange={setTopic} placeholder="What is the video about?" />
        </div>
      )}

      {mode === "captions" && (
        <div className="space-y-3">
          <DeskSelectField
            isLight={isLight}
            label="Caption pack (free — fills the desk)"
            value=""
            onChange={applyCaptionPack}
            options={[
              { value: "", label: "Pick a caption pack…" },
              ...CAPTION_PACKS.map((p) => ({ value: p.slug, label: p.title })),
            ]}
          />
          <DeskTextField isLight={isLight} label="What is the post about?" value={topic} onChange={setTopic} />
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskSelectField
              isLight={isLight}
              label="Platform"
              value={capPlatform}
              onChange={(v) => setCapPlatform(v as CaptionPlatform)}
              options={CAPTION_PLATFORMS.map((p) => ({ value: p, label: p }))}
            />
            <DeskTextField isLight={isLight} label="Tone (optional)" value={capTone} onChange={setCapTone} />
          </div>
        </div>
      )}

      {mode === "preflight" && (
        <div className="space-y-3">
          <DeskTextField isLight={isLight} label="Video title" value={pfTitle} onChange={setPfTitle} />
          <DeskTextField isLight={isLight} label="Caption (optional)" value={pfCaption} onChange={setPfCaption} />
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskTextField isLight={isLight} label="Hashtags (optional)" value={pfHashtags} onChange={setPfHashtags} />
            <DeskTextField isLight={isLight} label="Description (optional)" value={pfDescription} onChange={setPfDescription} />
          </div>
          <p className={`text-xs ${muted}`}>
            A viral-READINESS score — how well the post is engineered to earn attention. Never a
            virality guarantee: no one can predict what blows up.
          </p>
        </div>
      )}

      {mode === "cta" && (
        <div className="space-y-3">
          <DeskTextField isLight={isLight} label="What is the video about?" value={topic} onChange={setTopic} />
          <div className="grid gap-3 sm:grid-cols-3">
            <DeskSelectField
              isLight={isLight}
              label="Goal"
              value={ctaGoal}
              onChange={(v) => setCtaGoal(v as CtaGoal)}
              options={CTA_GOALS.map((g) => ({ value: g, label: g }))}
            />
            <DeskSelectField
              isLight={isLight}
              label="Platform"
              value={ctaPlatform}
              onChange={(v) => setCtaPlatform(v as CtaPlatform)}
              options={CTA_PLATFORMS.map((p) => ({ value: p, label: p }))}
            />
            <DeskTextField isLight={isLight} label="Tone (optional)" value={ctaTone} onChange={setCtaTone} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span data-testid="world-hook-desk-cost" className={`text-xs font-semibold ${muted}`}>
          Costs {cost.toLocaleString("en-US")} Visual Bucs — shown before anything runs.
        </span>
        <button
          type="button"
          data-testid="world-hook-desk-run"
          onClick={() => void run()}
          disabled={busy || !ready}
          className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? "Writing…" : RUN_LABEL[mode]}
        </button>
      </div>
      {!ready && mode !== "hooks" && (
        <p className={`text-xs ${muted}`}>
          {mode === "preflight" ? "Add the video's title first — the scorecard needs it." : "Add what it's about first — the writer needs it."}
        </p>
      )}
      {outOfCredits && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          You&rsquo;re out of Visual Bucs — top up at the Visual Buc Packs desk in the Treasury and the Hook Desk is ready again.
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
              CTA: {captionResult.cta}
            </p>
          )}
        </div>
      )}

      {mode === "preflight" && preflight && (
        <div data-testid="world-hook-desk-result" className="space-y-2">
          <p className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
            Readiness {preflight.score}/100{preflight.verdict ? ` — ${preflight.verdict}` : ""}
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
                {c.placement}{c.strength > 0 ? ` · strength ${c.strength}` : ""}
              </span>
            </p>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div>
          <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            This session
          </p>
          <div className="flex flex-wrap gap-1.5">
            {history.map((entry, i) => (
              <button
                key={`${entry.mode}-${entry.label}-${i}`}
                type="button"
                onClick={() => restoreHistory(entry)}
                className={chipCls(mode === entry.mode)}
              >
                {entry.mode}: {entry.label || "make"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
