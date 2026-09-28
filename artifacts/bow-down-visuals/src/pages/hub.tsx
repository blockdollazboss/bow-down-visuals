import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarketingBadge } from "@/components/MarketingBadge";
import {
  Drum, Scissors, Disc3, Clapperboard, Megaphone, Check, Plus,
  Trash2, Download, ArrowRight, FolderOpen, Sparkles, Music4,
} from "lucide-react";
import { useHubProject, type HubAsset, type HubAssetKind } from "@/lib/hub-project";
import { BeatMakerModule } from "./beat-maker";

/* ─── Creation Hub ──────────────────────────────────────────────────────────
   One place where almost everything gets made. A project holds every asset;
   the workflow rail (Beat → Stems → Song → Video → Promo) shows live status;
   each finished asset offers its natural next step. Tools report into the
   project via useHubProject().addAsset(...) — no page rewrites needed. */

interface WorkflowStep {
  key: string;
  label: string;
  icon: typeof Drum;
  assetKind: HubAssetKind | null; // null = launcher only for now
  href: string;
  blurb: string;
  creditNote: string;
}

const WORKFLOW: WorkflowStep[] = [
  { key: "beat", label: "Beat", icon: Drum, assetKind: "beat", href: "/hub",
    blurb: "AI-generate an instrumental or program drums on the step sequencer.",
    creditNote: "3 credits · sequencer free" },
  { key: "stems", label: "Stems", icon: Scissors, assetKind: "stems", href: "/stems",
    blurb: "Split any audio into vocals, drums, bass, and melody stems.",
    creditNote: "4 credits" },
  { key: "song", label: "Song", icon: Disc3, assetKind: "song", href: "/make-song",
    blurb: "Turn the beat into a full song with AI vocals and arrangement.",
    creditNote: "4 credits" },
  { key: "video", label: "Video", icon: Clapperboard, assetKind: "video", href: "/make-video",
    blurb: "Generate the music video — scenes, lip sync, full edit.",
    creditNote: "from 4 credits" },
  { key: "promo", label: "Promo", icon: Megaphone, assetKind: "clip", href: "/promo-clip",
    blurb: "Cut promo clips, make the thumbnail, ship it everywhere.",
    creditNote: "from 1 credit" },
];

/* Where each finished asset naturally wants to go next. */
const NEXT_STEPS: Record<HubAssetKind, { label: string; href: string }[]> = {
  beat: [
    { label: "Split into stems", href: "/stems" },
    { label: "Make it a song", href: "/make-song" },
  ],
  stems: [{ label: "Make it a song", href: "/make-song" }],
  song: [
    { label: "Make the video", href: "/make-video" },
    { label: "Cut a promo clip", href: "/promo-clip" },
  ],
  video: [
    { label: "Cut a promo clip", href: "/promo-clip" },
    { label: "Make a thumbnail", href: "/thumbnail-maker" },
  ],
  clip: [{ label: "Make a thumbnail", href: "/thumbnail-maker" }],
  thumbnail: [{ label: "Cut a promo clip", href: "/promo-clip" }],
  image: [{ label: "Make the video", href: "/make-video" }],
  other: [],
};

const KIND_LABEL: Record<HubAssetKind, string> = {
  beat: "Beat", stems: "Stems", song: "Song", video: "Video",
  clip: "Clip", thumbnail: "Thumbnail", image: "Image", other: "Asset",
};

const AUDIO_KINDS: HubAssetKind[] = ["beat", "song", "stems", "clip"];

function AssetCard({ asset }: { asset: HubAsset }) {
  const { removeAsset } = useHubProject();
  const next = NEXT_STEPS[asset.kind] ?? [];
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/15 text-primary mb-1.5">
            {KIND_LABEL[asset.kind]}
          </span>
          <p className="text-white text-sm font-medium truncate">{asset.label}</p>
          {asset.detail && <p className="text-white/40 text-xs mt-0.5 truncate">{asset.detail}</p>}
        </div>
        <button
          type="button"
          onClick={() => removeAsset(asset.id)}
          className="text-white/30 hover:text-red-400 transition-colors shrink-0"
          aria-label={`Remove ${asset.label}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      {AUDIO_KINDS.includes(asset.kind) && (
        <audio src={asset.url} controls className="w-full h-8" />
      )}
      {asset.kind === "video" && (
        <video src={asset.url} controls className="w-full rounded-lg max-h-40" />
      )}
      {(asset.kind === "image" || asset.kind === "thumbnail") && (
        <img src={asset.url} alt={asset.label} className="w-full rounded-lg max-h-40 object-cover" />
      )}
      <div className="flex flex-wrap gap-2">
        <a
          href={asset.url} download target="_blank" rel="noreferrer"
          className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white border border-white/15 rounded-lg px-2.5 py-1.5 transition-colors"
        >
          <Download className="w-3.5 h-3.5" /> Download
        </a>
        {next.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="flex items-center gap-1.5 text-xs font-semibold text-black bg-primary rounded-lg px-2.5 py-1.5 hover:bg-primary/90 transition-colors"
          >
            {n.label} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function Hub() {
  const { project, setProjectName, addAsset, newProject, hasKind } = useHubProject();
  const [activeStep, setActiveStep] = useState("beat");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);

  const step = WORKFLOW.find((s) => s.key === activeStep) ?? WORKFLOW[0]!;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-black text-white">Creation Hub</h1>
          <MarketingBadge variant="muted">Beta</MarketingBadge>
        </div>
        <Button
          variant="outline"
          onClick={() => { newProject(); setActiveStep("beat"); }}
          className="rounded-xl border-white/15 text-white/70 hover:text-white hover:border-white/30"
        >
          <Plus className="w-4 h-4 mr-2" /> New project
        </Button>
      </div>

      {/* Project name */}
      <div className="flex items-center gap-2">
        <FolderOpen className="w-4 h-4 text-primary shrink-0" />
        {editingName ? (
          <Input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => { setProjectName(nameDraft); setEditingName(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { setProjectName(nameDraft); setEditingName(false); }
              if (e.key === "Escape") { setNameDraft(project.name); setEditingName(false); }
            }}
            className="h-9 max-w-xs bg-white/[0.04] border-white/[0.08] text-white rounded-xl"
          />
        ) : (
          <button
            type="button"
            onClick={() => { setNameDraft(project.name); setEditingName(true); }}
            className="text-white/80 font-semibold hover:text-white transition-colors"
            title="Rename project"
          >
            {project.name}
          </button>
        )}
        <span className="text-white/30 text-sm">
          · {project.assets.length} asset{project.assets.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Workflow rail */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {WORKFLOW.map((s, i) => {
          const done = s.assetKind ? hasKind(s.assetKind) : false;
          const active = s.key === activeStep;
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setActiveStep(s.key)}
              className={`relative rounded-2xl border p-4 text-left transition-all ${
                active
                  ? "border-primary bg-primary/[0.08] shadow-[0_0_24px_rgba(218,165,32,0.15)]"
                  : "border-white/10 bg-white/[0.03] hover:border-white/25"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-white/30 uppercase tracking-wider">
                  Step {i + 1}
                </span>
                {done && (
                  <span className="w-5 h-5 rounded-full bg-emerald-400 flex items-center justify-center">
                    <Check className="w-3 h-3 text-black" strokeWidth={3} />
                  </span>
                )}
              </div>
              <Icon className={`w-6 h-6 mb-1.5 ${active ? "text-primary" : "text-white/50"}`} />
              <p className="text-white font-semibold text-sm">{s.label}</p>
              <p className="text-white/35 text-[11px] mt-0.5">{s.creditNote}</p>
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Stage */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 min-h-[420px]">
          <div className="mb-5">
            <h2 className="text-white font-bold text-lg flex items-center gap-2">
              <step.icon className="w-5 h-5 text-primary" /> {step.label}
            </h2>
            <p className="text-white/45 text-sm mt-1">{step.blurb}</p>
          </div>

          {step.key === "beat" ? (
            <BeatMakerModule
              onGenerated={(beat) =>
                addAsset({
                  kind: "beat",
                  url: beat.url,
                  label: beat.title,
                  detail: `${Math.round(beat.durationMs / 1000)}s · AI generated`,
                })
              }
            />
          ) : (
            <div className="space-y-4">
              {step.assetKind && project.assets.filter((a) => a.kind === step.assetKind).length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {project.assets
                    .filter((a) => a.kind === step.assetKind)
                    .map((a) => <AssetCard key={a.id} asset={a} />)}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/15 p-10 text-center">
                  <step.icon className="w-10 h-10 text-white/20 mx-auto mb-3" />
                  <p className="text-white/50 text-sm max-w-sm mx-auto">
                    Nothing here yet. Open the {step.label.toLowerCase()} studio — anything you
                    make lands back in this project automatically.
                  </p>
                </div>
              )}
              <Link href={step.href}>
                <Button className="h-11 px-6 rounded-xl bg-primary text-black font-bold hover:bg-primary/90">
                  <Sparkles className="w-4 h-4 mr-2" /> Open {step.label} Studio
                </Button>
              </Link>
            </div>
          )}
        </div>

        {/* Project tray */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 h-fit lg:sticky lg:top-6">
          <h3 className="text-white font-semibold mb-1 flex items-center gap-2">
            <Music4 className="w-4 h-4 text-primary" /> Project assets
          </h3>
          <p className="text-white/35 text-xs mb-4">
            Everything you make — here or in any studio — collects in this project.
          </p>
          {project.assets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 p-6 text-center">
              <p className="text-white/40 text-sm">
                Make your first beat to kick off <span className="text-white/70 font-medium">{project.name}</span>.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              {project.assets.map((a) => <AssetCard key={a.id} asset={a} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
