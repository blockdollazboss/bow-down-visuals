    import { useState, useCallback, useEffect, useRef } from "react";
    import {
      Film,
      ArrowUp,
      ArrowDown,
      Trash2,
      Plus,
      Pencil,
      CheckCircle2,
      Circle,
      Save,
      Loader2,
      Clock,
      X,
      Check,
      Music2,
      Clapperboard,
      Eye,
      AlertCircle,
      AlertTriangle,
      RefreshCw,
      Zap,
      Sparkles,
    } from "lucide-react";
    import { Button } from "@/components/ui/button";
    import type { SceneData } from "@/lib/scene-parser";
    import { useAuth } from "@/contexts/AuthContext";
    import { useToast } from "@/hooks/use-toast";
    import { OutOfCredits } from "@/components/OutOfCredits";
    import {
      requestImprovedPrompt,
      sceneSeedPrompt,
      isWeakPrompt,
      type ArtistVaultPayload,
    } from "@/lib/prompt-improve";

    /* ─── Helpers ─── */

    function parseDuration(ts: string | undefined | null): string {
      if (!ts) return "";
      const m = ts.match(/(\d+):(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return "";
      const start = parseInt(m[1]!) * 60 + parseFloat(m[2]!);
      const end = parseInt(m[3]!) * 60 + parseFloat(m[4]!);
      const diff = end - start;
      return diff > 0 ? `${Math.round(diff * 10) / 10}s` : "";
    }

    const SECTION_COLORS: Record<string, string> = {
      intro: "bg-purple-500/20 text-purple-300 border-purple-500/30",
      verse: "bg-blue-500/20  text-blue-300  border-blue-500/30",
      hook: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
      chorus: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
      bridge: "bg-cyan-500/20  text-cyan-300  border-cyan-500/30",
      outro: "bg-rose-500/20  text-rose-300  border-rose-500/30",
      pre: "bg-orange-500/20 text-orange-300 border-orange-500/30",
      break: "bg-green-500/20 text-green-300 border-green-500/30",
    };

    function sectionColor(s: string): string {
      const l = s.toLowerCase();
      for (const key of Object.keys(SECTION_COLORS)) {
        if (l.includes(key)) return SECTION_COLORS[key]!;
      }
      return "bg-white/10 text-white/50 border-white/20";
    }

    function statusBadge(scene: SceneData, isPolling: boolean) {
      if (isPolling) {
        return {
          label: "Generating",
          cls: "text-yellow-300 bg-yellow-500/10 border-yellow-500/25",
        };
      }

      if (scene.approved && scene.generationStatus === "completed") {
        return {
          label: "Approved",
          cls: "text-primary bg-primary/15 border-primary/30",
        };
      }

      if (scene.generationStatus === "completed") {
        return {
          label: "Completed",
          cls: "text-green-300 bg-green-500/10 border-green-500/25",
        };
      }

      if (scene.generationStatus === "failed") {
        return {
          label: "Failed",
          cls: "text-red-300 bg-red-500/10 border-red-500/25",
        };
      }

      return {
        label: "Not Generated",
        cls: "text-white/35 bg-white/5 border-white/10",
      };
    }

    /* ─── Runway Clip Generator ─── */

    const IS_DEV = import.meta.env.DEV;

    interface RunwayClipProps {
      scene: SceneData;
      onUpdate: (patch: Partial<SceneData>) => void;
      isLocked: boolean;
      onGeneratingStart: () => void;
      onGeneratingEnd: () => void;
      projectId?: string | null;
    }

    function RunwayClipGenerator({
      scene,
      onUpdate,
      isLocked,
      onGeneratingStart,
      onGeneratingEnd,
      projectId,
    }: RunwayClipProps) {
      const { getAccessToken, refreshProfile } = useAuth();
      const { toast } = useToast();

      const [isPolling, setIsPolling] = useState(false);
      const [taskId, setTaskId] = useState<string | null>(null);
      const [progress, setProgress] = useState<number | null>(null);
      const [error, setError] = useState<string | null>(null);
      const [showRegenConfirm, setShowRegenConfirm] = useState(false);
      const [urlError, setUrlError] = useState(false);
      const [outOfCredits, setOutOfCredits] = useState(false);

      const onUpdateRef = useRef(onUpdate);
      const promptUsedRef = useRef<string>("");
      const onGeneratingEndRef = useRef(onGeneratingEnd);

      useEffect(() => {
        onUpdateRef.current = onUpdate;
        onGeneratingEndRef.current = onGeneratingEnd;
      });

      const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

      function stopPolling() {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }

      useEffect(() => {
        return () => stopPolling();
      }, []);

      async function autoSaveClip(clipUrl: string, jobId: string) {
        try {
          const token = await getAccessToken();

          const res = await fetch("/api/generated-clips", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token ?? ""}`,
            },
            body: JSON.stringify({
              projectId: projectId ?? null,
              sceneId: scene.id ?? null,
              title: scene.section || scene.timestamp || "Scene Clip",
              prompt: scene.aiVideoPrompt || null,
              finalPrompt: promptUsedRef.current || null,
              runwayJobId: jobId,
              videoUrl: clipUrl,
              status: "completed",
            }),
          });

          if (res.ok) {
            refreshProfile();
          } else {
            const body = (await res.json().catch(() => ({}))) as {
              creditMessage?: string;
            };

            toast({
              title: "Save failed",
              description: body.creditMessage ?? "Clip generated but saving failed.",
              variant: "destructive",
            });

            refreshProfile();
          }
        } catch {
          // Best effort autosave.
        }
      }

      function startPolling(id: string) {
        stopPolling();

        pollRef.current = setInterval(async () => {
          try {
            const token = await getAccessToken();

            const res = await fetch(`/api/generate-runway-clip/${id}`, {
              headers: {
                Authorization: `Bearer ${token ?? ""}`,
              },
            });

            const data = (await res.json()) as {
              status: string;
              url?: string;
              progress?: number;
              error?: string;
            };

            if (IS_DEV) {
              console.log("[Runway] poll:", data.status, data.progress ?? "");
            }

            if (data.status === "succeeded" && data.url) {
              stopPolling();
              setIsPolling(false);
              onGeneratingEndRef.current();

              void autoSaveClip(data.url, id);

              onUpdateRef.current({
                demoClipUrl: data.url,
                provider: "Runway",
                generationStatus: "completed",
                promptUsed: promptUsedRef.current,
                generatedAt: new Date().toISOString(),
              });

              if (IS_DEV) console.log("[Runway] done:", data.url);
            } else if (data.status === "failed" || data.status === "cancelled") {
              stopPolling();
              setIsPolling(false);
              setError(data.error ?? "Runway returned a failure with no message");
              onUpdateRef.current({ generationStatus: "failed" });
              onGeneratingEndRef.current();

              if (IS_DEV) console.log("[Runway] failed:", data.error);
            } else {
              setProgress(typeof data.progress === "number" ? data.progress : null);
            }
          } catch (e) {
            stopPolling();
            setIsPolling(false);
            setError(
              e instanceof Error ? e.message : "Network error while polling Runway",
            );
            onUpdateRef.current({ generationStatus: "failed" });
            onGeneratingEndRef.current();
          }
        }, 5000);
      }

      function buildPrompt(): string {
        if (scene.aiVideoPrompt?.trim()) return scene.aiVideoPrompt.trim();

        const fallback = [
          scene.action,
          scene.location,
          scene.cameraMovement,
          scene.lighting,
          scene.mood,
        ]
          .filter(Boolean)
          .join(", ");

        return (
          fallback ||
          "cinematic music video scene, dramatic lighting, luxury aesthetic"
        );
      }

      async function doGenerate() {
        const promptText = buildPrompt();
        promptUsedRef.current = promptText;

        if (IS_DEV) console.log("[Runway] starting:", promptText.slice(0, 80));

        setIsPolling(true);
        setError(null);
        setProgress(null);
        setShowRegenConfirm(false);
        setUrlError(false);
        onGeneratingStart();

        try {
          const token = await getAccessToken();

          const res = await fetch("/api/generate-runway-clip", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token ?? ""}`,
            },
            body: JSON.stringify({
              promptText,
              negativePrompt: scene.negativePrompt ?? "",
              ratio: "720:1280",
            }),
          });

          const data = (await res.json()) as {
            taskId?: string;
            error?: string;
          };

          if (!res.ok || !data.taskId) {
            throw new Error(data.error ?? `Runway API error (HTTP ${res.status})`);
          }

          if (IS_DEV) console.log("[Runway] task:", data.taskId);

          setTaskId(data.taskId);
          startPolling(data.taskId);
        } catch (e) {
          const msg =
            e instanceof Error ? e.message : "Failed to start Runway generation";

          setIsPolling(false);

          if (msg === "out_of_credits") {
            setOutOfCredits(true);
            refreshProfile();
            onGeneratingEndRef.current();
            return;
          }

          setError(msg);
          onUpdateRef.current({ generationStatus: "failed" });
          onGeneratingEndRef.current();

          if (IS_DEV) console.log("[Runway] error:", msg);
        }
      }

      function handleRemoveClip() {
        stopPolling();

        if (isPolling) onGeneratingEndRef.current();

        setIsPolling(false);
        setTaskId(null);
        setError(null);
        setProgress(null);
        setShowRegenConfirm(false);
        setUrlError(false);

        onUpdateRef.current({
          demoClipUrl: null,
          generationStatus: null,
          provider: null,
          promptUsed: null,
          generatedAt: null,
          approved: false,
        });
      }

      const hasPrompt = !!scene.aiVideoPrompt?.trim();

      return (
        <div className="mt-4 space-y-3 border-t border-white/[0.04] pt-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">
              Runway
            </span>

            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                isPolling
                  ? "text-yellow-300 bg-yellow-500/10 border-yellow-500/25"
                  : scene.approved && scene.generationStatus === "completed"
                    ? "text-primary bg-primary/15 border-primary/30"
                    : scene.generationStatus === "completed"
                      ? "text-green-300 bg-green-500/10 border-green-500/25"
                      : scene.generationStatus === "failed"
                        ? "text-red-300 bg-red-500/10 border-red-500/25"
                        : "text-white/30 bg-white/5 border-white/10"
              }`}
            >
              {isPolling && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
              {scene.approved && scene.generationStatus === "completed" && (
                <CheckCircle2 className="h-2.5 w-2.5" />
              )}
              {scene.generationStatus === "completed" && !scene.approved && (
                <Zap className="h-2.5 w-2.5" />
              )}

              {isPolling
                ? "Generating"
                : scene.approved && scene.generationStatus === "completed"
                  ? "Approved"
                  : scene.generationStatus === "completed"
                    ? "Completed"
                    : scene.generationStatus === "failed"
                      ? "Failed"
                      : "Not Generated"}
            </span>

            {scene.generatedAt && !isPolling && (
              <span className="text-[9px] text-white/20">
                {new Date(scene.generatedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>

          {isPolling && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/20 bg-primary/5">
              <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-primary/80">
                  Generating Runway clip…
                </p>
                <p className="text-[11px] text-white/30 mt-0.5">
                  This takes 30–90 seconds
                </p>

                {progress !== null && (
                  <div className="mt-2 w-full h-1 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-1000"
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                )}

                {IS_DEV && taskId && (
                  <p className="text-[9px] font-mono text-white/20 mt-1">
                    DEV · taskId: {taskId}
                  </p>
                )}
              </div>
            </div>
          )}

          {!isPolling && error && (
            <div className="flex gap-2 px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/5">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-300/70 leading-relaxed break-words flex-1">
                {error}
              </p>
            </div>
          )}

          {!isPolling && (
            <div className="space-y-1.5">
              {urlError || !scene.demoClipUrl ? (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-yellow-500/25 bg-yellow-500/5">
                  <AlertCircle className="h-4 w-4 text-yellow-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-yellow-300">
                      {!scene.demoClipUrl ? "No generated video yet" : "Clip link expired"}
                    </p>
                    <p className="text-[11px] text-yellow-300/60 mt-0.5">
                      Click "Generate Runway Clip" below to launch your rendering engine pipeline.
                    </p>
                  </div>
                </div>
              ) : (
                <video
                  key={scene.demoClipUrl}
                  src={scene.demoClipUrl}
                  controls
                  preload="metadata"
                  autoPlay
                  poster="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&q=80"
                  muted
                  loop
                  playsInline
                  className="w-full rounded-xl border border-green-500/20"
                  style={{ background: "#000" }}
                  onError={() => setUrlError(true)}
                />
              )}

              {IS_DEV && scene.demoClipUrl && (
                <p className="text-[9px] font-mono text-white/15 break-all px-0.5">
                  DEV · {scene.demoClipUrl.slice(0, 72)}…
                </p>
              )}
            </div>
          )}

          {showRegenConfirm && !isPolling && (
            <div className="flex items-center gap-2 flex-wrap px-3 py-2.5 rounded-xl border border-yellow-500/25 bg-yellow-500/5">
              <span className="text-[11px] text-yellow-300/80 font-medium flex-1">
                This will use Runway API credits. Continue?
              </span>

              <button
                onClick={doGenerate}
                className="px-3 py-1 rounded-lg bg-primary/20 border border-primary/30 text-primary text-xs font-bold hover:bg-primary/30 transition-colors"
              >
                Yes, Regenerate
              </button>

              <button
                onClick={() => setShowRegenConfirm(false)}
                className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-white/40 text-xs font-bold hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {!isPolling && !showRegenConfirm && (
            <div className="flex flex-wrap gap-2">
              {!scene.demoClipUrl && (
                <button
                  onClick={doGenerate}
                  disabled={isLocked}
                  title={
                    isLocked
                      ? "Another clip is generating. Please wait."
                      : undefined
                  }
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-primary/30 bg-primary/10 text-primary text-xs font-bold hover:border-primary/50 hover:bg-primary/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="btn-generate-runway-clip"
                >
                  <Zap className="h-3.5 w-3.5" />
                  Generate Runway Clip
                  {!hasPrompt && (
                    <span className="text-primary/50 font-normal">
                      (using scene info)
                    </span>
                  )}
                </button>
              )}

              {scene.demoClipUrl && (
                <button
                  onClick={() => setShowRegenConfirm(true)}
                  disabled={isLocked}
                  title={
                    isLocked
                      ? "Another clip is generating. Please wait."
                      : undefined
                  }
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] text-white/50 text-xs font-bold hover:border-primary/30 hover:text-primary hover:bg-primary/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="btn-regenerate-runway-clip"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Regenerate
                </button>
              )}

              {scene.demoClipUrl && (
                <button
                  onClick={() => onUpdate({ approved: !scene.approved })}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-bold transition-all ${
                    scene.approved
                      ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/5 hover:border-primary/20"
                      : "border-white/10 bg-white/[0.03] text-white/50 hover:border-primary/30 hover:text-primary hover:bg-primary/10"
                  }`}
                  data-testid="btn-approve-clip"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {scene.approved ? "Approved ✓" : "Approve Clip"}
                </button>
              )}

              {scene.demoClipUrl && (
                <button
                  onClick={handleRemoveClip}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] text-white/35 text-xs font-bold hover:border-red-500/30 hover:text-red-400 hover:bg-red-500/5 transition-all"
                  data-testid="btn-remove-clip"
                >
                  <X className="h-3.5 w-3.5" /> Remove Clip
                </button>
              )}
            </div>
          )}

          {outOfCredits && (
            <div className="mt-2">
              <OutOfCredits />
            </div>
          )}

          {isLocked && !isPolling && !scene.demoClipUrl && (
            <p className="text-[11px] text-white/25 flex items-center gap-1.5 pl-0.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Another clip is generating. Please wait.
            </p>
          )}

          {IS_DEV && !isPolling && (
            <p className="text-[9px] font-mono text-white/15 leading-relaxed">
              DEV ·{" "}
              {hasPrompt
                ? `prompt: "${scene.aiVideoPrompt.slice(0, 50)}…"`
                : `fallback: "${buildPrompt().slice(0, 50)}…"`}
            </p>
          )}
        </div>
      );
    }

    /* ─── Timeline Scene Row ─── */

    interface TimelineRowProps {
      scene: SceneData;
      index: number;
      isFirst: boolean;
      isLast: boolean;
      onUpdate: (patch: Partial<SceneData>) => void;
      onMoveUp: () => void;
      onMoveDown: () => void;
      onRemove: () => void;
      isLocked: boolean;
      isThisGenerating: boolean;
      onGeneratingStart: () => void;
      onGeneratingEnd: () => void;
      projectId?: string | null;
      artistVault?: ArtistVaultPayload | null;
      videoStyle?: string;
      platform?: string;
      /** Driven by "Improve All Prompts" — shows progress on this row during a bulk run. */
      externalImproving?: boolean;
    }

    function TimelineRow({
      scene,
      index,
      isFirst,
      isLast,
      onUpdate,
      onMoveUp,
      onMoveDown,
      onRemove,
      isLocked,
      isThisGenerating,
      onGeneratingStart,
      onGeneratingEnd,
      projectId,
      artistVault,
      videoStyle,
      platform,
      externalImproving,
    }: TimelineRowProps) {
      const { getAccessToken } = useAuth();
      const { toast } = useToast();

      const [editing, setEditing] = useState(false);
      const [editedPrompt, setEditedPrompt] = useState(scene.aiVideoPrompt ?? "");
      const [copied, setCopied] = useState(false);
      const [improving, setImproving] = useState(false);

      const duration = parseDuration(scene.timestamp);
      const status = statusBadge(scene, isThisGenerating);
      const busyImproving = improving || !!externalImproving;

      function handleSaveEdit() {
        onUpdate({ aiVideoPrompt: editedPrompt });
        setEditing(false);
      }

      function handleCopyPrompt() {
        navigator.clipboard.writeText(scene.aiVideoPrompt ?? "");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }

      async function handleImprovePrompt() {
        const seed = sceneSeedPrompt(scene);
        if (!seed) {
          toast({
            title: "Nothing to improve",
            description: "Add a prompt or scene details first.",
            variant: "destructive",
          });
          return;
        }
        setImproving(true);
        try {
          const token = await getAccessToken();
          const improvedPrompt = await requestImprovedPrompt({
            token, prompt: seed, scene, artistVault, videoStyle, platform,
          });
          onUpdate({ aiVideoPrompt: improvedPrompt });
          setEditedPrompt(improvedPrompt);
          toast({ title: "Prompt improved!", description: "Your AI Video Prompt has been enhanced for Runway." });
        } catch {
          toast({ title: "Could not improve prompt", variant: "destructive" });
        } finally {
          setImproving(false);
        }
      }

      return (
        <div
          className={`rounded-xl border overflow-hidden transition-all duration-200 ${
            scene.approved
              ? "border-primary/40 shadow-[0_0_20px_rgba(234,179,8,0.04)]"
              : "border-white/[0.07]"
          } bg-[#0a0a0a]`}
          data-testid={`timeline-scene-${index}`}
        >
          <div
            className={`flex items-center gap-2 px-4 py-3 border-b border-white/[0.05] ${
              scene.approved ? "bg-primary/[0.03]" : "bg-white/[0.01]"
            }`}
          >
            <button
              onClick={() => onUpdate({ approved: !scene.approved })}
              className="shrink-0 transition-transform hover:scale-110"
              title={scene.approved ? "Remove approval" : "Approve scene"}
              data-testid={`timeline-approve-toggle-${index}`}
            >
              {scene.approved ? (
                <CheckCircle2 className="h-5 w-5 text-primary" />
              ) : (
                <Circle className="h-5 w-5 text-white/15 hover:text-white/40 transition-colors" />
              )}
            </button>

            <span className="text-xs font-black text-white/25 tabular-nums w-5 shrink-0">
              {String(index + 1).padStart(2, "0")}
            </span>

            {scene.section && (
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${sectionColor(
                  scene.section,
                )}`}
              >
                {scene.section}
              </span>
            )}

            {scene.timestamp && (
              <span className="flex items-center gap-1 text-xs text-white/30 shrink-0">
                <Clock className="h-3 w-3" /> {scene.timestamp}
                {duration && <span className="text-white/20">· {duration}</span>}
              </span>
            )}

            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border hidden sm:inline-flex ${status.cls}`}
            >
              {status.label}
            </span>

            {scene.provider && scene.generationStatus === "completed" && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 hidden sm:inline-flex items-center gap-1">
                <Zap className="h-2.5 w-2.5" /> {scene.provider}
              </span>
            )}

            {!busyImproving && isWeakPrompt(scene) && (
              <button
                onClick={handleImprovePrompt}
                className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors inline-flex items-center gap-1 shrink-0"
                title="This scene's AI Video Prompt is short or generic — click to improve it"
                data-testid={`badge-weak-prompt-${index}`}
              >
                <AlertTriangle className="h-2.5 w-2.5" /> Weak Prompt
              </button>
            )}

            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={onMoveUp}
                disabled={isFirst}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-white/20 hover:text-white/60 hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                title="Move Up"
                data-testid={`timeline-move-up-${index}`}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>

              <button
                onClick={onMoveDown}
                disabled={isLast}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-white/20 hover:text-white/60 hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                title="Move Down"
                data-testid={`timeline-move-down-${index}`}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>

              <button
                onClick={onRemove}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="Remove Scene"
                data-testid={`timeline-remove-${index}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {scene.lyricLine && (
            <div className="px-4 py-2 border-b border-white/[0.04]">
              <p className="text-xs italic text-white/30">"{scene.lyricLine}"</p>
            </div>
          )}

          <div className="p-4 space-y-4">
            {(scene.action ||
              scene.location ||
              scene.cameraMovement ||
              scene.lighting) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-3 border-b border-white/[0.04]">
                {(scene.action || scene.location) && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-white/25 uppercase tracking-widest flex items-center gap-1.5">
                      <Eye className="h-3 w-3" /> Visual Description
                    </span>
                    <p className="text-xs text-white/50 leading-relaxed">
                      {[scene.action, scene.location].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                )}

                {scene.cameraMovement && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-white/25 uppercase tracking-widest flex items-center gap-1.5">
                      <Film className="h-3 w-3" /> Camera Direction
                    </span>
                    <p className="text-xs text-white/50 leading-relaxed">
                      {scene.cameraMovement}
                    </p>
                  </div>
                )}

                {scene.lighting && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-white/25 uppercase tracking-widest flex items-center gap-1.5">
                      <Music2 className="h-3 w-3" /> Lighting
                    </span>
                    <p className="text-xs text-white/50 leading-relaxed">
                      {scene.lighting}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-primary/50 uppercase tracking-widest">
                  AI Video Prompt
                </span>

                <div className="flex items-center gap-1">
                  <button
                    onClick={handleImprovePrompt}
                    disabled={busyImproving}
                    className="flex items-center gap-1 text-[11px] text-primary/60 hover:text-primary transition-colors px-1.5 py-0.5 rounded hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed"
                    data-testid={`timeline-improve-prompt-${index}`}
                  >
                    {busyImproving ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" /> Improving…
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3 w-3" /> Improve
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleCopyPrompt}
                    className="flex items-center gap-1 text-[11px] text-white/25 hover:text-primary transition-colors px-1.5 py-0.5 rounded hover:bg-primary/10"
                  >
                    {copied ? (
                      <Check className="h-3 w-3 text-green-400" />
                    ) : (
                      <span>Copy</span>
                    )}
                  </button>

                  {!editing && (
                    <button
                      onClick={() => {
                        setEditedPrompt(scene.aiVideoPrompt ?? "");
                        setEditing(true);
                      }}
                      className="flex items-center gap-1 text-[11px] text-white/25 hover:text-primary transition-colors px-1.5 py-0.5 rounded hover:bg-primary/10"
                      data-testid={`timeline-edit-prompt-${index}`}
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                  )}
                </div>
              </div>

              {editing ? (
                <div className="space-y-2">
                  <textarea
                    value={editedPrompt}
                    onChange={(e) => setEditedPrompt(e.target.value)}
                    rows={4}
                    className="w-full bg-white/[0.04] border border-primary/30 rounded-lg px-3 py-2 text-sm text-white/80 leading-relaxed resize-none focus:outline-none focus:border-primary/60 transition-colors"
                    placeholder="Describe the AI video prompt for this scene..."
                    data-testid={`timeline-prompt-textarea-${index}`}
                  />

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleSaveEdit}
                      className="gold-glow h-7 text-xs"
                      data-testid={`timeline-save-prompt-${index}`}
                    >
                      Save
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(false)}
                      className="border-white/10 bg-white/5 text-white/50 h-7 text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-white/55 leading-relaxed bg-white/[0.02] rounded-lg px-3 py-2.5 border border-white/[0.05] min-h-[60px]">
                  {scene.aiVideoPrompt || (
                    <span className="italic text-white/20">
                      No prompt yet — click Edit to add one
                    </span>
                  )}
                </p>
              )}
            </div>

            {scene.negativePrompt && (
              <p className="text-[11px] text-white/25 leading-relaxed bg-white/[0.02] rounded-lg px-3 py-2 border border-white/[0.04]">
                <span className="font-black text-white/20 uppercase tracking-wider text-[9px]">
                  Negative:{" "}
                </span>
                {scene.negativePrompt}
              </p>
            )}

            <RunwayClipGenerator
              scene={scene}
              onUpdate={onUpdate}
              isLocked={isLocked}
              onGeneratingStart={onGeneratingStart}
              onGeneratingEnd={onGeneratingEnd}
              projectId={projectId}
            />
          </div>
        </div>
      );
    }

    /* ─── Main Export ─── */

    interface ExportRecord {
      final_video_url: string;
      export_status: string;
      export_created_at: string;
      clips_used: number;
      audio_used: boolean;
      timeline_order?: string[];
    }

    interface MusicVideoTimelineProps {
      scenes: SceneData[];
      onScenesChange: (scenes: SceneData[]) => void;
      audioUrl?: string | null;
      projectId?: string | null;
      onSaveSuccess?: () => void;
      existingExport?: ExportRecord | null;
      onExportComplete?: (record: ExportRecord) => void;
      artistVault?: ArtistVaultPayload | null;
      videoStyle?: string;
      platform?: string;
    }

    export function MusicVideoTimeline({
      scenes,
      onScenesChange,
      audioUrl,
      projectId,
      onSaveSuccess,
      artistVault,
      videoStyle,
      platform,
    }: MusicVideoTimelineProps) {
      const { getAccessToken } = useAuth();
      const { toast } = useToast();

      const [saving, setSaving] = useState(false);
      const [activeGeneratingId, setActiveGeneratingId] = useState<string | null>(
        null,
      );
      const [improvingIds, setImprovingIds] = useState<Set<string>>(new Set());
      const [improveAllTotal, setImproveAllTotal] = useState(0);
      const improveAllActive = improveAllTotal > 0;

      const approvedCount = scenes.filter((s) => s.approved).length;
      const clippedCount = scenes.filter((s) => s.demoClipUrl).length;

      // Guards against overlapping in-flight autosave PATCH requests while
      // "Improve All Prompts" is running — always saves the latest snapshot,
      // never an older one that raced ahead of it.
      const autosaveInFlightRef = useRef(false);
      const autosavePendingScenesRef = useRef<SceneData[] | null>(null);

      const persistScenesInBackground = useCallback(
        async (scenesToSave: SceneData[]) => {
          if (!projectId) return;

          if (autosaveInFlightRef.current) {
            autosavePendingScenesRef.current = scenesToSave;
            return;
          }

          autosaveInFlightRef.current = true;
          try {
            const token = await getAccessToken();
            await fetch(`/api/projects/${projectId}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token ?? ""}`,
              },
              body: JSON.stringify({ scenes: scenesToSave }),
            });
          } catch {
            // Best-effort autosave — the explicit "Save Timeline" action
            // remains the source of truth and will surface real errors.
          } finally {
            autosaveInFlightRef.current = false;
            const pending = autosavePendingScenesRef.current;
            if (pending) {
              autosavePendingScenesRef.current = null;
              void persistScenesInBackground(pending);
            }
          }
        },
        [projectId, getAccessToken],
      );

      // Warn the user before they close/reload the tab mid-bulk-run so
      // improved prompts already returned by the server aren't lost.
      useEffect(() => {
        if (!improveAllActive) return;

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
          e.preventDefault();
          e.returnValue = "";
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
      }, [improveAllActive]);

      const handleImproveAllPrompts = useCallback(async () => {
        if (improveAllActive) return;
        const targets = scenes.filter((s) => sceneSeedPrompt(s).length > 0);
        if (targets.length === 0) {
          toast({
            title: "Nothing to improve",
            description: "Add some scene details or prompts first.",
            variant: "destructive",
          });
          return;
        }

        setImproveAllTotal(targets.length);
        setImprovingIds(new Set(targets.map((s) => s.id)));

        let working = [...scenes];
        let ok = 0;
        let fail = 0;
        try {
          const token = await getAccessToken();

          await Promise.allSettled(
            targets.map(async (scene) => {
              try {
                const improved = await requestImprovedPrompt({
                  token, prompt: sceneSeedPrompt(scene), scene, artistVault, videoStyle, platform,
                });
                working = working.map((s) => (s.id === scene.id ? { ...s, aiVideoPrompt: improved } : s));
                onScenesChange(working);
                void persistScenesInBackground(working);
                ok++;
              } catch {
                fail++;
              } finally {
                setImprovingIds((prev) => {
                  const next = new Set(prev);
                  next.delete(scene.id);
                  return next;
                });
              }
            }),
          );

          toast({
            title: fail === 0 ? "All prompts improved!" : `Improved ${ok} of ${targets.length} scenes`,
            description:
              fail === 0
                ? `Enhanced ${ok} scene${ok !== 1 ? "s" : ""} for Runway.`
                : `${fail} scene${fail !== 1 ? "s" : ""} could not be improved — retry those individually.`,
            variant: fail === 0 ? undefined : "destructive",
          });
        } catch {
          toast({
            title: "Could not improve prompts",
            description: "Something went wrong starting the batch. Please try again.",
            variant: "destructive",
          });
        } finally {
          setImproveAllTotal(0);
          setImprovingIds(new Set());
        }
      }, [scenes, artistVault, videoStyle, platform, getAccessToken, onScenesChange, toast, improveAllActive, persistScenesInBackground]);

      const handleUpdate = useCallback(
        async (id: string, patch: Partial<SceneData>) => {
          const updatedScenes = scenes.map((s) =>
            s.id === id ? { ...s, ...patch } : s,
          );

          onScenesChange(updatedScenes);

          const shouldAutoSave =
            projectId &&
            (("demoClipUrl" in patch && patch.demoClipUrl) ||
              "approved" in patch ||
              ("generationStatus" in patch &&
                patch.generationStatus === "completed"));

          if (shouldAutoSave) {
            try {
              const token = await getAccessToken();

              await fetch(`/api/projects/${projectId}`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token ?? ""}`,
                },
                body: JSON.stringify({ scenes: updatedScenes }),
              });

              if ("demoClipUrl" in patch && patch.demoClipUrl) {
                toast({
                  title: "Clip saved!",
                  description: "Your Runway clip has been saved to this project.",
                });
              }
            } catch {
              toast({
                title: "Changes not saved",
                description: "Click Save Timeline to persist.",
                variant: "destructive",
              });
            }
          }
        },
        [scenes, onScenesChange, projectId, getAccessToken, toast],
      );

      function handleMoveUp(index: number) {
        if (index === 0) return;

        const next = [...scenes];
        [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];

        onScenesChange(next);
      }

      function handleMoveDown(index: number) {
        if (index === scenes.length - 1) return;

        const next = [...scenes];
        [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];

        onScenesChange(next);
      }

      function handleRemove(index: number) {
        const next = scenes.filter((_, i) => i !== index);
        onScenesChange(next);
      }

      function handleAddScene() {
        const newScene = {
          id: crypto.randomUUID(),
          section: "Custom",
          timestamp: "",
          lyricLine: "",
          action: "",
          location: "",
          cameraMovement: "",
          lighting: "",
          mood: "",
          aiVideoPrompt: "",
          negativePrompt: "distorted face, deformed hands, extra fingers, extra limbs, blurry, low quality, watermark, text overlay, cartoon, anime, oversaturated, harsh shadows on face",
          approved: false,
          demoClipUrl: null,
          generationStatus: null,
          provider: null,
          promptUsed: null,
          generatedAt: null,
        } as SceneData;

        onScenesChange([...scenes, newScene]);
      }

      async function handleSaveTimeline() {
        if (!projectId) {
          toast({
            title: "No project selected",
            description: "Open or create a project before saving the timeline.",
            variant: "destructive",
          });
          return;
        }

        setSaving(true);

        try {
          const token = await getAccessToken();

          const res = await fetch(`/api/projects/${projectId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token ?? ""}`,
            },
            body: JSON.stringify({ scenes }),
          });

          if (!res.ok) {
            throw new Error("Failed to save layout configuration.");
          }

          toast({
            title: "Timeline Saved",
            description: "All structural changes are live.",
          });

          onSaveSuccess?.();
        } catch (error) {
          console.error("Failed to save timeline:", error);

          toast({
            title: "Save failed",
            description:
              error instanceof Error
                ? error.message
                : "Could not save the timeline.",
            variant: "destructive",
          });
        } finally {
          setSaving(false);
        }
      }

      return (
        <section className="rounded-2xl border border-white/[0.08] bg-black/40 p-4 sm:p-5 space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Clapperboard className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-black text-white">
                  Music Video Timeline
                </h2>
              </div>

              <p className="text-xs text-white/35 mt-1">
                Arrange scenes, generate Runway clips, approve shots, then save your timeline.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] px-3 py-1 rounded-full border border-white/10 bg-white/[0.03] text-white/45">
                {scenes.length} Scenes
              </span>

              <span className="text-[11px] px-3 py-1 rounded-full border border-green-500/20 bg-green-500/5 text-green-300/70">
                {clippedCount} Clips
              </span>

              <span className="text-[11px] px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary/80">
                {approvedCount} Approved
              </span>
            </div>
          </div>

          {audioUrl && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <p className="text-[10px] font-black text-white/25 uppercase tracking-widest mb-2">
                Reference Audio
              </p>

              <audio src={audioUrl} controls className="w-full" />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={handleSaveTimeline}
              disabled={saving}
              className="gold-glow"
              data-testid="btn-save-timeline"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {saving ? "Saving..." : "Save Timeline"}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleAddScene}
              className="border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
              data-testid="btn-add-timeline-scene"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Scene
            </Button>

            {scenes.length > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={handleImproveAllPrompts}
                disabled={improveAllActive}
                className="border-primary/20 bg-primary/5 text-primary/80 hover:bg-primary/15 hover:text-primary font-bold"
                data-testid="btn-improve-all-prompts"
              >
                {improveAllActive ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Improving {improveAllTotal - improvingIds.size}/{improveAllTotal}…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Improve All Prompts
                  </>
                )}
              </Button>
            )}
          </div>

          {scenes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
              <Film className="h-8 w-8 text-white/20 mx-auto mb-3" />
              <p className="text-sm font-bold text-white/50">No scenes yet</p>
              <p className="text-xs text-white/25 mt-1">
                Add a scene or generate a video plan to build your timeline.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {scenes.map((scene, index) => (
                <TimelineRow
                  key={scene.id ?? index}
                  scene={scene}
                  index={index}
                  isFirst={index === 0}
                  isLast={index === scenes.length - 1}
                  onUpdate={(patch) => handleUpdate(scene.id, patch)}
                  onMoveUp={() => handleMoveUp(index)}
                  onMoveDown={() => handleMoveDown(index)}
                  onRemove={() => handleRemove(index)}
                  isLocked={
                    activeGeneratingId !== null && activeGeneratingId !== scene.id
                  }
                  isThisGenerating={activeGeneratingId === scene.id}
                  onGeneratingStart={() => setActiveGeneratingId(scene.id)}
                  onGeneratingEnd={() => setActiveGeneratingId(null)}
                  projectId={projectId}
                  artistVault={artistVault}
                  videoStyle={videoStyle}
                  platform={platform}
                  externalImproving={improvingIds.has(scene.id)}
                />
              ))}
            </div>
          )}
        </section>
      );
    }