import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarketingBadge } from "@/components/MarketingBadge";
import {
  Check, Plus, Trash2, Download, ArrowRight, FolderOpen, Sparkles, Music4,
  Layers, ChevronLeft, Zap, FilePlus2, type LucideIcon,
} from "lucide-react";
import { useHubProject, type HubAsset, type HubAssetKind, type HubProjectType } from "@/lib/hub-project";
import {
  getWorkflow, PROJECT_WORKFLOWS, FAMILIES, KIND_LABEL, AUDIO_KINDS, NEXT_STEPS,
  type WorkflowStep,
} from "@/lib/hub-workflows";
import { getTemplates, getTemplate, type HubTemplate } from "@/lib/hub-templates";
import { useTranslation } from "react-i18next";
import { BeatMakerModule } from "./beat-maker";
import { ThumbnailMakerModule } from "./thumbnail-maker";

/* ─── Creation Hub ──────────────────────────────────────────────────────────
   One place for everything. Pick what you're making and the hub walks you
   through that craft's chain — every step feeds the next, every finished
   asset lands in the project tray with its natural next move attached.

   Two views, one brain:
   - Guide me (default): ONE step on screen. Do it, it's done, next. This is
     the cheat-code view — no walls of links, no decisions, just momentum.
   - All steps (advanced): the full workflow rail for users who want the map.

   Tools report in via useHubProject().addAsset. Steps with an assetKind
   complete themselves when the asset lands; hands-on steps (idea, cast…)
   get a "Done, next" button that stores progress per project type. */

function AssetCard({ asset }: { asset: HubAsset }) {
  const { t } = useTranslation();
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
          aria-label={t("hub.removeAssetAria", { label: asset.label })}
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
          <Download className="w-3.5 h-3.5" /> {t("hub.download")}
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
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 md:p-12 text-center max-w-4xl mx-auto">
      <Layers className="w-10 h-10 text-primary mx-auto mb-4" />
      <h2 className="text-white font-black text-2xl mb-2">{t("hub.typePickerTitle")}</h2>
      <p className="text-white/45 text-sm mb-8 max-w-md mx-auto">
        {t("hub.typePickerSub")}
      </p>
      <div className="space-y-8 text-left">
        {FAMILIES.map((f) => {
          const members = PROJECT_WORKFLOWS.filter((w) => w.family === f.key);
          if (members.length === 0) return null;
          return (
            <div key={f.key}>
              <p className="text-white/60 text-xs font-bold uppercase tracking-widest mb-1">{f.label}</p>
              <p className="text-white/35 text-xs mb-3">{f.blurb}</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {members.map((w) => {
                  const Icon: LucideIcon = w.icon;
                  return (
                    <button
                      key={w.type}
                      type="button"
                      onClick={() => onPick(w.type)}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 hover:border-primary/60 hover:bg-primary/[0.06] transition-all group text-left"
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
        })}
      </div>
    </div>
  );
}

/* ─── Template picker: CapCut-style preloaded starters ───────────────────── */

function TemplatePicker({ type, onPick, onBack }: { type: HubProjectType; onPick: (t: HubTemplate | null) => void; onBack: () => void }) {
  const { t } = useTranslation();
  const workflow = getWorkflow(type);
  const templates = getTemplates(type);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 md:p-12 max-w-4xl mx-auto">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-white/40 hover:text-white text-sm mb-6 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" /> {t("hub.allProjectTypes")}
      </button>
      <h2 className="text-white font-black text-2xl mb-2">{t("hub.startFromTemplate", { title: workflow.title })}</h2>
      <p className="text-white/45 text-sm mb-8 max-w-md">
        {t("hub.templatePickerSub")}
      </p>
      <div className="grid sm:grid-cols-2 gap-3 text-left">
        <button
          key="__blank"
          type="button"
          onClick={() => onPick(null)}
          className="rounded-2xl border border-dashed border-white/15 bg-transparent p-5 hover:border-primary/60 hover:bg-primary/[0.04] transition-all group text-left"
        >
          <FilePlus2 className="w-7 h-7 text-white/40 mb-3 group-hover:text-primary group-hover:scale-110 transition-all" />
          <p className="text-white font-bold mb-1">{t("hub.startBlank")}</p>
          <p className="text-white/40 text-xs leading-relaxed">{t("hub.startBlankBlurb")}</p>
        </button>
        {templates.map((tpl) => {
          const Icon: LucideIcon = tpl.icon;
          return (
            <button
              key={tpl.key}
              type="button"
              onClick={() => onPick(tpl)}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 hover:border-primary/60 hover:bg-primary/[0.06] transition-all group text-left"
            >
              <Icon className="w-7 h-7 text-primary mb-3 group-hover:scale-110 transition-transform" />
              <p className="text-white font-bold mb-1">{tpl.name}</p>
              <p className="text-white/40 text-xs leading-relaxed mb-2">{tpl.blurb}</p>
              <p className="text-primary/70 text-[11px] font-semibold flex items-center gap-1">
                <Zap className="w-3 h-3" /> {t("hub.preloadedStarters", { count: tpl.preload.length })}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmbeddedModule({ step }: { step: WorkflowStep }) {
  const { t } = useTranslation();
  const { addAsset } = useHubProject();
  if (step.embed === "beat-maker") {
    return (
      <BeatMakerModule
        onGenerated={(beat) =>
          addAsset({
            kind: "beat",
            url: beat.url,
            label: beat.title,
            detail: t("hub.beatDetail", { seconds: Math.round(beat.durationMs / 1000) }),
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

/* ─── Guided view: the cheat-code view ────────────────────────────────────── */

function GuidedView({ onNewProject }: { onNewProject: () => void }) {
  const { t } = useTranslation();
  const { project, hasKind, stepDones, markStepDone } = useHubProject();
  const workflow = getWorkflow(project.type);
  const steps = workflow.steps;
  const template = getTemplate(project.type, project.templateKey);

  const isDone = (s: WorkflowStep) =>
    (s.assetKind ? hasKind(s.assetKind) : false) || stepDones.includes(s.key);
  const doneCount = steps.filter(isDone).length;
  const allDone = doneCount === steps.length;

  const firstOpen = () => {
    const i = steps.findIndex((s) => !isDone(s));
    return i === -1 ? steps.length - 1 : i;
  };
  const [idx, setIdx] = useState<number>(firstOpen);
  // Restart the guide when the project type changes.
  useEffect(() => {
    setIdx(firstOpen());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.type]);

  const safeIdx = Math.min(idx, steps.length - 1);
  const step = steps[safeIdx]!;
  const done = isDone(step);
  const next = steps[safeIdx + 1] ?? null;
  const Icon = step.icon;
  const assets = step.assetKind ? project.assets.filter((a) => a.kind === step.assetKind) : [];
  const stepHint = template?.preload.find((ph) => ph.step === step.key);

  const advance = () => {
    if (next) setIdx(safeIdx + 1);
  };
  const finishStep = () => {
    markStepDone(step.key);
    advance();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Preloaded concept */}
      {project.concept && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/35 mb-2">
            {t("hub.yourConcept")}
            {template && <span className="text-primary/70 normal-case">{t("hub.templateNameSuffix", { name: template.name })}</span>}
          </p>
          <p className="text-white/70 text-sm leading-relaxed">{project.concept}</p>
        </div>
      )}

      {/* Progress */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-white/50 text-xs font-bold uppercase tracking-widest">
            {allDone ? t("hub.complete") : t("hub.stepOf", { current: safeIdx + 1, total: steps.length })}
          </p>
          <p className="text-white/50 text-xs">{t("hub.doneCount", { done: doneCount, total: steps.length })}</p>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {allDone ? (
        <div className="rounded-2xl border border-primary/30 bg-primary/[0.06] p-8 md:p-10 text-center">
          <Sparkles className="w-10 h-10 text-primary mx-auto mb-4" />
          <h2 className="text-white font-black text-2xl mb-2">{t("hub.chainCompleteTitle")}</h2>
          <p className="text-white/50 text-sm max-w-sm mx-auto mb-6">
            {t("hub.chainCompleteSub", { name: project.name, count: project.assets.length })}
          </p>
          <Button
            onClick={onNewProject}
            className="h-11 px-6 rounded-xl bg-primary text-black font-bold hover:bg-primary/90"
          >
            <Plus className="w-4 h-4 mr-2" /> {t("hub.startSomethingNew")}
          </Button>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/35 mb-3">
            {t("hub.stepN", { n: safeIdx + 1 })}
            {done
              ? <span className="text-emerald-400"> · {t("hub.doneWord")}</span>
              : <span> · {step.creditNote}</span>}
          </p>
          <div className="flex items-center gap-3 mb-2">
            <span className="w-11 h-11 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0">
              <Icon className="w-6 h-6 text-primary" />
            </span>
            <h2 className="text-white font-black text-xl">{step.label}</h2>
            {done && (
              <span className="w-6 h-6 rounded-full bg-emerald-400 flex items-center justify-center shrink-0">
                <Check className="w-4 h-4 text-black" strokeWidth={3} />
              </span>
            )}
          </div>
          <p className="text-white/50 text-sm leading-relaxed mb-4">{step.blurb}</p>

          {stepHint && (
            <div className="rounded-xl border border-primary/25 bg-primary/[0.06] p-4 mb-6 flex gap-3">
              <Zap className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-primary text-[11px] font-bold uppercase tracking-widest mb-1">{t("hub.preloadedStarter")}</p>
                <p className="text-white/75 text-sm leading-relaxed">{stepHint.hint}</p>
              </div>
            </div>
          )}

          {done ? (
            <div className="space-y-4">
              {assets.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {assets.slice(0, 2).map((a) => <AssetCard key={a.id} asset={a} />)}
                </div>
              )}
              <p className="text-emerald-300/90 text-sm font-semibold">
                {t("hub.stepLockedIn", { label: step.label })}
              </p>
              {next ? (
                <Button
                  onClick={advance}
                  className="w-full h-12 rounded-xl bg-primary text-black font-bold text-base hover:bg-primary/90"
                >
                  {t("hub.nextUp", { label: next.label })} <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              ) : (
                <p className="text-white/60 text-sm">{t("hub.lastStepComplete")}</p>
              )}
              {step.assetKind && !step.embed && (
                <div className="text-center">
                  <Link href={step.href} className="text-white/40 hover:text-white text-xs underline underline-offset-4">
                    {t("hub.makeAnother", { label: step.label.toLowerCase() })}
                  </Link>
                </div>
              )}
            </div>
          ) : step.embed ? (
            <div className="space-y-4">
              <EmbeddedModule step={step} />
              <div className="text-center">
                <button
                  type="button"
                  onClick={finishStep}
                  className="text-white/40 hover:text-white text-xs underline underline-offset-4"
                >
                  {t("hub.skipForNow")}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Link href={step.href} className="block">
                <Button className="w-full h-12 rounded-xl bg-primary text-black font-bold text-base hover:bg-primary/90">
                  <Sparkles className="w-5 h-5 mr-2" />
                  {step.assetKind ? t("hub.makeMy", { label: step.label.toLowerCase() }) : t("hub.openX", { label: step.label })}
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
              <p className="text-white/35 text-xs text-center">
                {t("hub.anythingLandsBack")}
              </p>
              <div className="text-center">
                <button
                  type="button"
                  onClick={finishStep}
                  className="text-white/40 hover:text-white text-xs underline underline-offset-4"
                >
                  {step.skipLabel ?? (step.assetKind ? t("hub.skipForNow") : t("hub.doneNext"))}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Slim tray strip: proof the cheat code is working */}
      {project.assets.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-white/40 text-xs font-bold uppercase tracking-widest mb-3">
            {t("hub.yourStuffSoFar", { count: project.assets.length })}
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {project.assets.slice(0, 12).map((a) => (
              <div
                key={a.id}
                className="shrink-0 max-w-[180px] rounded-lg border border-white/10 bg-black/40 px-3 py-2"
              >
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  {KIND_LABEL[a.kind]}
                </p>
                <p className="text-white/70 text-xs truncate">{a.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── All-steps view: the advanced map ────────────────────────────────────── */

function AllStepsView() {
  const { t } = useTranslation();
  const { project, setProjectType, hasKind } = useHubProject();
  const workflow = getWorkflow(project.type);
  const [activeStep, setActiveStep] = useState<string | null>(null);

  const step = workflow.steps.find((s) => s.key === (activeStep ?? workflow.steps[0]!.key)) ?? workflow.steps[0]!;
  const upNext = workflow.steps.find((s) => s.assetKind && !hasKind(s.assetKind))?.key;

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-white/30 text-sm">·</span>
        <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.04] border border-white/10 max-w-full overflow-x-auto">
          {PROJECT_WORKFLOWS.map((w) => (
            <button
              key={w.type}
              type="button"
              onClick={() => { setProjectType(w.type); setActiveStep(null); }}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                w.type === project.type ? "bg-primary text-black" : "text-white/50 hover:text-white"
              }`}
            >
              {w.title}
            </button>
          ))}
        </div>
        <span className="text-white/30 text-sm">
          {t("hub.trayAssetCount", { count: project.assets.length })}
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
                  {isNext ? <span className="text-primary">{t("hub.upNext")}</span> : t("hub.stepN", { n: i + 1 })}
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
                    {t("hub.nothingHereYet", { label: step.label.toLowerCase() })}
                  </p>
                </div>
              )}
              <Link href={step.href}>
                <Button className="h-11 px-6 rounded-xl bg-primary text-black font-bold hover:bg-primary/90">
                  <Sparkles className="w-4 h-4 mr-2" /> {t("hub.openStudio", { label: step.label })}
                </Button>
              </Link>
            </div>
          )}
        </div>

        {/* Project tray */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 h-fit lg:sticky lg:top-6">
          <h3 className="text-white font-semibold mb-1 flex items-center gap-2">
            <Music4 className="w-4 h-4 text-primary" /> {t("hub.projectAssets")}
          </h3>
          <p className="text-white/35 text-xs mb-4">
            {t("hub.trayExplainer")}
          </p>
          {project.assets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 p-6 text-center">
              <p className="text-white/40 text-sm">
                {t("hub.emptyTrayBefore")}<span className="text-white/70 font-medium">{project.name}</span>{t("hub.emptyTrayAfter")}
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
  );
}

export default function Hub() {
  const { t } = useTranslation();
  const { project, setProjectName, setProjectType, setProjectConcept, setTemplateKey, setAttribution, newProject, clearStepDones } = useHubProject();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [pickingType, setPickingType] = useState(project.assets.length === 0);
  const [templateType, setTemplateType] = useState<HubProjectType | null>(null);
  const [view, setView] = useState<"guided" | "all">("guided");

  const startWithTemplate = (t: HubProjectType, tpl: HubTemplate | null) => {
    clearStepDones(t);
    newProject();
    setProjectType(t);
    if (tpl) {
      setProjectName(tpl.projectName);
      setProjectConcept(tpl.concept);
      setTemplateKey(tpl.key);
    }
    setTemplateType(null);
    setPickingType(false);
    setView("guided");
  };

  const backToPicker = () => {
    setTemplateType(null);
    setPickingType(true);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          {!pickingType && (
            <button
              type="button"
              onClick={() => setPickingType(true)}
              className="text-white/40 hover:text-white transition-colors"
              aria-label={t("hub.backToPickerAria")}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <h1 className="text-3xl font-black text-white">Hub</h1>
          <MarketingBadge variant="muted">{t("hub.beta")}</MarketingBadge>
        </div>
        <div className="flex items-center gap-2">
          {!pickingType && (
            <div className="flex p-0.5 rounded-xl bg-white/[0.04] border border-white/10">
              <button
                type="button"
                onClick={() => setView("guided")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  view === "guided" ? "bg-primary text-black" : "text-white/50 hover:text-white"
                }`}
              >
                {t("hub.guideMe")}
              </button>
              <button
                type="button"
                onClick={() => setView("all")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  view === "all" ? "bg-primary text-black" : "text-white/50 hover:text-white"
                }`}
              >
                {t("hub.allSteps")}
              </button>
            </div>
          )}
          <Button
            variant="outline"
            onClick={backToPicker}
            className="rounded-xl border-white/15 text-white/70 hover:text-white hover:border-white/30"
          >
            <Plus className="w-4 h-4 mr-2" /> {t("hub.newProject")}
          </Button>
        </div>
      </div>

      {pickingType ? (
        templateType ? (
          <TemplatePicker
            type={templateType}
            onPick={(tpl) => startWithTemplate(templateType, tpl)}
            onBack={() => setTemplateType(null)}
          />
        ) : (
          <TypePicker onPick={setTemplateType} />
        )
      ) : (
        <>
          {/* Project name */}
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
                title={t("hub.renameProjectTitle")}
              >
                {project.name}
              </button>
            )}
            <span className="text-white/30 text-sm">·</span>
            <span className="text-white/30 text-sm">{getWorkflow(project.type).title}</span>
            {/* Virality: project-level "Made with Bow Down Visuals" credit.
                Default ON — flows into every export/share from every tool. */}
            <button
              type="button"
              role="switch"
              aria-checked={project.attribution}
              onClick={() => setAttribution(!project.attribution)}
              title={t("hubSpine.attributionDesc")}
              className={`ml-2 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-all ${
                project.attribution
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-white/10 bg-white/[0.03] text-white/40 hover:text-white/70"
              }`}
            >
              <span className={`relative h-4 w-7 rounded-full transition-colors ${project.attribution ? "bg-primary" : "bg-white/15"}`}>
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-black transition-all ${project.attribution ? "left-3.5" : "left-0.5"}`} />
              </span>
              {t("hubSpine.attributionTitle")}
            </button>
          </div>

          {view === "guided" ? (
            <GuidedView onNewProject={() => setPickingType(true)} />
          ) : (
            <AllStepsView />
          )}
        </>
      )}
    </div>
  );
}
