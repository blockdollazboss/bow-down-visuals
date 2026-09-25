import { useState, useCallback } from "react";
import { Copy, Check, Save, Loader2, FileText, FileDown, ChevronDown, ChevronUp, Music, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { downloadTxt, downloadPdf } from "@/lib/export-utils";
import type { SongStructure } from "@/lib/song-structure";
import { SongSectionAnalysis } from "@/components/SongSectionAnalysis";
import { SceneStudio } from "@/components/SceneStudio";
import { OpenVideoEditorButton } from "@/components/OpenVideoEditorButton";
import { parseScenes, type SceneData } from "@/lib/scene-parser";
import type { ArtistVault } from "@/components/ArtistVaultSelector";
import { generateMusicAudio } from "@/lib/generate-music-audio";
import { OutOfCredits } from "@/components/OutOfCredits";

interface Section {
  title: string;
  content: string;
  isSceneBreakdown?: boolean;
}

function parseSections(raw: string): Section[] {
  const lines = raw.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) sections.push(current);
      const title = line.replace(/^## /, "").trim();
      current = {
        title,
        content: "",
        isSceneBreakdown: /scene.by.scene|scene breakdown/i.test(title),
      };
    } else if (current) {
      current.content += line + "\n";
    }
  }
  if (current) sections.push(current);

  return sections
    .map((s) => ({ ...s, content: s.content.trim() }))
    .filter((s) => s.content.length > 0);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded-md hover:bg-primary/10"
      data-testid="btn-copy-section"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function CollapsibleSection({ index, title, content, defaultOpen }: { index: number; title: string; content: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden" data-testid={`result-section-${index}`}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-secondary/50">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-3 flex-1 text-left"
          data-testid={`btn-toggle-section-${index}`}
        >
          <span className="text-xs font-bold text-primary/50 tabular-nums">{String(index + 1).padStart(2, "0")}</span>
          <h3 className="font-bold text-white text-sm tracking-wide uppercase flex-1">{title}</h3>
          {open ? <ChevronUp className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4 text-white/40" />}
        </button>
        <div className="pl-3">
          <CopyButton text={content} />
        </div>
      </div>
      {open && (
        <div className="px-5 py-4">
          <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed">{content}</pre>
        </div>
      )}
    </div>
  );
}

export interface SaveMetadata {
  projectType: string;
  artistName?: string;
  songTitle?: string;
  genre?: string;
  mood?: string;
  inputData: Record<string, unknown>;
  creditsUsed?: number;
  songStructure?: SongStructure;
  thumbnailImageUrl?: string | null;
}

interface GenerationResultProps {
  result: string;
  onReset: () => void;
  saveMetadata: SaveMetadata;
  initialScenes?: SceneData[];
  scenes?: SceneData[];
  onScenesChange?: (s: SceneData[]) => void;
  artistVault?: ArtistVault | null;
  onSaved?: (projectId: string) => void;
  showScenes?: boolean;
  collapsibleSections?: boolean;
}

export function GenerationResult({ result, onReset, saveMetadata, initialScenes, scenes: externalScenes, onScenesChange, artistVault, onSaved, showScenes = true, collapsibleSections = false }: GenerationResultProps) {
  const sections = parseSections(result);
  const musicPromptSection = sections.find((s) => /ai music prompt/i.test(s.title));
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [audioOutOfCredits, setAudioOutOfCredits] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState(
    [saveMetadata.artistName, saveMetadata.songTitle].filter(Boolean).join(" — ") ||
    saveMetadata.songTitle ||
    saveMetadata.artistName ||
    ""
  );

  // Internal fallback scenes (uncontrolled mode)
  const [internalScenes, setInternalScenes] = useState<SceneData[]>(() => {
    if (initialScenes && initialScenes.length > 0) return initialScenes;
    const breakdownSection = sections.find((s) => s.isSceneBreakdown);
    if (breakdownSection) return parseScenes(breakdownSection.content);
    return [];
  });

  // Use external scenes if caller is controlling them, else internal
  const scenes = externalScenes !== undefined ? externalScenes : internalScenes;

  const handleScenesChange = useCallback((updated: SceneData[]) => {
    if (onScenesChange) onScenesChange(updated);
    else setInternalScenes(updated);
  }, [onScenesChange]);

  function handleCopyAll() {
    navigator.clipboard.writeText(result);
    toast({ title: "Copied!", description: "All content copied to clipboard." });
  }

  function handleDownloadTxt() {
    downloadTxt({
      projectType: saveMetadata.projectType,
      artistName:  saveMetadata.artistName,
      songTitle:   saveMetadata.songTitle,
      genre:       saveMetadata.genre,
      mood:        saveMetadata.mood,
      result,
    });
  }

  function handleDownloadPdf() {
    downloadPdf({
      projectType: saveMetadata.projectType,
      artistName:  saveMetadata.artistName,
      songTitle:   saveMetadata.songTitle,
      genre:       saveMetadata.genre,
      mood:        saveMetadata.mood,
      result,
    });
  }

  async function handleGenerateAudio() {
    if (!musicPromptSection) return;
    setGeneratingAudio(true);
    setAudioError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("You need to be signed in to generate audio.");
      const resp = await generateMusicAudio(token, {
        prompt: musicPromptSection.content,
        artistName: saveMetadata.artistName,
        songTitle: saveMetadata.songTitle,
        artistVaultId: artistVault?.id,
      });
      setGeneratedAudioUrl(resp.url);
      refreshProfile();
      toast({ title: "Audio generated!", description: "It will be attached to this project when you save." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not generate audio.";
      if (msg === "out_of_credits") {
        setAudioOutOfCredits(true);
        refreshProfile();
      } else {
        setAudioError(msg);
      }
    } finally {
      setGeneratingAudio(false);
    }
  }

  async function handleSave() {
    if (!user) {
      toast({ title: "Sign in required", description: "Sign in to save your projects.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          projectType: saveMetadata.projectType,
          title: projectTitle || saveMetadata.projectType,
          artistName: saveMetadata.artistName ?? null,
          songTitle: saveMetadata.songTitle ?? null,
          genre: saveMetadata.genre ?? null,
          mood: saveMetadata.mood ?? null,
          inputData: {
            ...saveMetadata.inputData,
            ...(generatedAudioUrl ? { audioUrl: generatedAudioUrl } : {}),
          },
          outputData: {
            result,
            ...(saveMetadata.songStructure ? { songStructure: saveMetadata.songStructure } : {}),
            ...(scenes.length > 0 ? { scenes } : {}),
            ...(saveMetadata.thumbnailImageUrl ? { thumbnailImageUrl: saveMetadata.thumbnailImageUrl } : {}),
          },
          creditsUsed: saveMetadata.creditsUsed ?? 1,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: "Save failed" }))) as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }
      const saved_data = (await res.json()) as { id: string };
      setSaved(true);
      setSavedProjectId(saved_data.id ?? null);
      if (onSaved && saved_data.id) onSaved(saved_data.id);
      toast({ title: "Project saved!", description: "Find it in My Projects." });
    } catch (err: unknown) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Could not save project.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 mt-10" data-testid="generation-result">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-bold tracking-widest text-primary uppercase">Result Ready</span>
          </div>
          <h2 className="text-2xl font-black text-white">{saveMetadata.projectType}</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleCopyAll}
            className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-2"
            data-testid="btn-copy-all">
            <Copy className="h-4 w-4" /> Copy All
          </Button>
          <Button variant="outline" size="sm" onClick={onReset}
            className="border-white/10 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white gap-2"
            data-testid="btn-generate-again">
            Generate Again
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadTxt}
            className="border-white/10 bg-white/5 text-white hover:bg-white/10 gap-2"
            data-testid="btn-download-txt">
            <FileText className="h-3.5 w-3.5" /> TXT
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadPdf}
            className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 gap-2"
            data-testid="btn-download-pdf">
            <FileDown className="h-3.5 w-3.5" /> PDF
          </Button>
        </div>
      </div>

      {/* Save Project Panel */}
      {!saved ? (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <Save className="h-5 w-5 text-primary shrink-0 mt-0.5 sm:mt-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-sm mb-2">Save this project to your vault</p>
            <Input
              value={projectTitle}
              onChange={e => setProjectTitle(e.target.value)}
              placeholder="Project title..."
              className="max-w-xs h-8 text-sm bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 rounded-lg"
              data-testid="input-project-title"
            />
          </div>
          <Button
            onClick={handleSave}
            disabled={saving || !user}
            className="gold-glow shrink-0"
            size="sm"
            data-testid="btn-save-project"
          >
            {saving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving...</> : "Save Project"}
          </Button>
        </div>
      ) : (
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Check className="h-5 w-5 text-green-400 shrink-0" />
            <p className="text-green-400 font-medium text-sm">Saved! View it in <a href="/my-projects" className="underline underline-offset-2">My Projects</a>.</p>
          </div>
          {savedProjectId && scenes.length > 0 && (
            <OpenVideoEditorButton projectId={savedProjectId} size="sm" testId="btn-result-open-video-editor" />
          )}
        </div>
      )}

      {/* Generate Real Audio Panel */}
      {musicPromptSection && (
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
          <div className="flex items-start gap-3">
            <Music className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white text-sm">Generate real audio from this prompt</p>
              <p className="text-xs text-white/40 mt-0.5">
                Turn the AI Music Prompt above into an actual playable track. It'll be attached to this project when you save.
              </p>
            </div>
            <Button
              onClick={handleGenerateAudio}
              disabled={generatingAudio || audioOutOfCredits}
              size="sm"
              className="gold-glow shrink-0"
              data-testid="btn-generate-audio"
            >
              {generatingAudio ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Generating...</> : "Generate Audio"}
            </Button>
          </div>

          {audioOutOfCredits && <OutOfCredits />}

          {audioError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/[0.08] border border-red-500/25">
              <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-200/90 leading-relaxed">{audioError}</p>
            </div>
          )}

          {generatedAudioUrl && (
            <div className="space-y-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                <p className="text-xs font-black text-emerald-300">Audio ready</p>
              </div>
              <audio controls src={generatedAudioUrl} className="w-full" data-testid="audio-generated-preview" />
            </div>
          )}
        </div>
      )}

      {/* Song Structure Analysis (if available) */}
      {saveMetadata.songStructure && (
        <SongSectionAnalysis analysis={saveMetadata.songStructure} />
      )}

      {/* Plan sections — raw AI output */}
      <div className="space-y-4">
        {sections.length > 0 ? sections.map((section, i) => (
          collapsibleSections ? (
            <CollapsibleSection
              key={i}
              index={i}
              title={section.title}
              content={section.content}
              defaultOpen={i === 0}
            />
          ) : (
          <div key={i} className="bg-card border border-card-border rounded-xl overflow-hidden"
            data-testid={`result-section-${i}`}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-secondary/50">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-primary/50 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="font-bold text-white text-sm tracking-wide uppercase">{section.title}</h3>
              </div>
              <CopyButton text={section.content} />
            </div>
            <div className="px-5 py-4">
              <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed">{section.content}</pre>
            </div>
          </div>
          )
        )) : (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
            <pre className="whitespace-pre-wrap font-sans text-sm text-white/70 leading-relaxed">{result}</pre>
          </div>
        )}
      </div>

      {/* Scene Cards For Video Generation — shown below the full plan */}
      {showScenes && scenes.length > 0 && (
        <div className="pt-4 border-t border-white/[0.06]">
          <SceneStudio
            scenes={scenes}
            onScenesChange={handleScenesChange}
            artistVault={artistVault}
            videoStyle={typeof saveMetadata.inputData?.["videoStyle"] === "string" ? (saveMetadata.inputData["videoStyle"] as string) : undefined}
            platform={typeof saveMetadata.inputData?.["platform"] === "string" ? (saveMetadata.inputData["platform"] as string) : undefined}
          />
        </div>
      )}
    </div>
  );
}
