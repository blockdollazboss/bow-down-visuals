import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarketingBadge } from "@/components/MarketingBadge";
import {
  Check, Plus, Trash2, Download, ArrowRight, FolderOpen, Sparkles, Music4,
  Layers, type LucideIcon,
} from "lucide-react";
import { useHubProject, type HubAsset, type HubAssetKind, type HubProjectType } from "@/lib/hub-project";
import {
  getWorkflow, PROJECT_WORKFLOWS, KIND_LABEL, AUDIO_KINDS, NEXT_STEPS,
  type WorkflowStep,
} from "@/lib/hub-workflows";
import { BeatMakerModule } from "./beat-maker";
import { ThumbnailMakerModule } from "./thumbnail-maker";

/* ─── Creation Hub ──────────────────────────────────────────────────────────
   One place for everything. Pick what you're making — a song, a video, or a
   visual/brand package — and the hub lays out that craft's chain: every step
   feeds the next, every finished asset lands in the project tray with its
   natural next move attached. Tools report in via useHubProject().addAsset. */

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
      {asset.kind === "script" && asset.meta?.text && (
        <p className="text-white/50 text-xs leading-relaxed line-clamp-3 border-l-2 border-primary/40 pl-3">
          {asset.meta.text.slice(0, 180)}{asset.meta.text.length > 180 ? "…" : ""}
        </p>
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
            key={n.label}
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

function TypePicker({ onPick }: { onPick: (t: HubProjectType) => void }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 md:p-12 text-center max-w-3xl mx-auto">
      <Layers className="w-10 h-10 text-primary mx-auto mb-4" />
      <h2 className="text-white font-black text-2xl mb-2">What are you making?</h2>
      <p className="text-white/45 text-sm mb-8 max-w-md mx-auto">
        The hub lays out the right chain for the job — every step flows into the next.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-left">
        {PROJECT_WORKFLOWS.map((w) => {
          const Icon: LucideIcon = w.icon;
          return (
            <button
              key={w.type}
              type="button"
              onClick={() => onPick(w.type)}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 hover:border-primary/60 hover:bg-primary/[0.06] transition-all group"
            >
              <Icon className="w-7 h-7 text-primary mb-3 group-hover:scale-110 transition-transform" />
              <p className="text-white font-bold mb-1">{w.title}</p>
              <p className="text-white/40 text-xs leading-relaxed">{w.tagline}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmbeddedModule({ step }: { step: WorkflowStep }) {
  const { addAsset } = useHubProject();
  if (step.embed === "beat-maker") {
    return (
      <BeatMakerModule
        onGenerated={(beat) =>
          addAsset({
            kind: "beat",
            url: beat.url,
            label: beat.title,
            detail: `${Math.round(beat.durationMs / 1000)}s · AI generated`,
            meta: beat.meta,
          })
        }
      />
    );
  }
  if (step.embed === "thumbnail-maker") {
    return <ThumbnailMakerModule />;
  }
  return null;
}

export default function Hub() {
  const { project, setProjectName, setProjectType, newProject, hasKind } = useHubProject();
  const workflow = getWorkflow(project.type);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [pickingType, setPickingType] = useState(project.assets.length === 0);

  const step = workflow.steps.find((s) => s.key === (activeStep ?? workflow.steps[0]!.key)) ?? workflow.steps[0]!;
  // First incomplete step = where the flow continues.
  const upNext = workflow.steps.find((s) => s.assetKind && !hasKind(s.assetKind))?.key;

  const startType = (t: HubProjectType) => {
    newProject();
    setProjectType(t);
    setPickingType(false);
    setActiveStep(null);
  };

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
          onClick={() => setPickingType(true)}
          className="rounded-xl border-white/15 text-white/70 hover:text-white hover:border-white/30"
        >
          <Plus className="w-4 h-4 mr-2" /> New project
        </Button>
      </div>

      {pickingType ? (
        <TypePicker onPick={startType} />
      ) : (
        <>
          {/* Project name + type */}
          <div className="flex items-center gap-3 flex-wrap">
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
            <span className="text-white/30 text-sm">·</span>
            <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.04] border border-white/10">
              {PROJECT_WORKFLOWS.map((w) => (
                <button
                  key={w.type}
                  type="button"
                  onClick={() => { setProjectType(w.type); setActiveStep(null); }}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                    w.type === project.type ? "bg-primary text-black" : "text-white/50 hover:text-white"
                  }`}
                >
                  {w.title}
                </button>
              ))}
            </div>
            <span className="text-white/30 text-sm">
              · {project.assets.length} asset{project.assets.length === 1 ? "" : "s"}
            </span>
          </div>

          {/* Workflow rail */}
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
            {workflow.steps.map((s, i) => {
              const done = s.assetKind ? hasKind(s.assetKind) : false;
              const active = s.key === step.key;
              const isNext = s.key === upNext && !done;
              const Icon = s.icon;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setActiveStep(s.key)}
                  className={`relative rounded-2xl border p-4 text-left transition-all shrink-0 w-[132px] sm:w-auto sm:shrink sm:flex-1 ${
                    active
                      ? "border-primary bg-primary/[0.08] shadow-[0_0_24px_rgba(218,165,32,0.15)]"
                      : "border-white/10 bg-white/[0.03] hover:border-white/25"
                  } ${isNext ? "ring-1 ring-primary/40" : ""}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-white/30 uppercase tracking-wider">
                      {isNext ? <span className="text-primary">Up next</span> : `Step ${i + 1}`}
                    </span>
                    {done && (
                      <span className="w-5 h-5 rounded-full bg-emerald-400 flex items-center justify-center">
                        <Check className="w-3 h-3 text-black" strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <Icon className={`w-6 h-6 mb-1.5 ${active ? "text-primary" : "text-white/50"}`} />
                  <p className="text-white font-semibold text-sm">{s.label}</p>
                  <p className="text-white/35 text-[11px] mt-0.5 hidden sm:block">{s.creditNote}</p>
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

              {step.embed ? (
                <EmbeddedModule step={step} />
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
                    Start step 1 and <span className="text-white/70 font-medium">{project.name}</span> comes alive.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                  {project.assets.map((a) => <AssetCard key={a.id} asset={a} />)}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
