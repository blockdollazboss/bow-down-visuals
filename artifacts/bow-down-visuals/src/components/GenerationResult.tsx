import { useState, useCallback } from "react";
import { Copy, Check, Save, Loader2, FileText, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { downloadTxt, downloadPdf } from "@/lib/export-utils";
import type { SongStructure } from "@/lib/song-structure";
import { SongSectionAnalysis } from "@/components/SongSectionAnalysis";
import { SceneStudio } from "@/components/SceneStudio";
import { parseScenes, type SceneData } from "@/lib/scene-parser";

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

export interface SaveMetadata {
  projectType: string;
  artistName?: string;
  songTitle?: string;
  genre?: string;
  mood?: string;
  inputData: Record<string, unknown>;
  creditsUsed?: number;
  songStructure?: SongStructure;
}

interface GenerationResultProps {
  result: string;
  onReset: () => void;
  saveMetadata: SaveMetadata;
  initialScenes?: SceneData[];
}

export function GenerationResult({ result, onReset, saveMetadata, initialScenes }: GenerationResultProps) {
  const sections = parseSections(result);
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [projectTitle, setProjectTitle] = useState(
    [saveMetadata.artistName, saveMetadata.songTitle].filter(Boolean).join(" — ") ||
    saveMetadata.songTitle ||
    saveMetadata.artistName ||
    ""
  );

  // Scene studio state — initialise from raw breakdown or from saved data
  const [scenes, setScenes] = useState<SceneData[]>(() => {
    if (initialScenes && initialScenes.length > 0) return initialScenes;
    const breakdownSection = sections.find((s) => s.isSceneBreakdown);
    if (breakdownSection) return parseScenes(breakdownSection.content);
    return [];
  });

  const handleScenesChange = useCallback((updated: SceneData[]) => {
    setScenes(updated);
  }, []);

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
          inputData: saveMetadata.inputData,
          outputData: {
            result,
            ...(saveMetadata.songStructure ? { songStructure: saveMetadata.songStructure } : {}),
            ...(scenes.length > 0 ? { scenes } : {}),
          },
          creditsUsed: saveMetadata.creditsUsed ?? 1,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: "Save failed" }))) as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }
      setSaved(true);
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
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 flex items-center gap-3">
          <Check className="h-5 w-5 text-green-400" />
          <p className="text-green-400 font-medium text-sm">Saved! View it in <a href="/my-projects" className="underline underline-offset-2">My Projects</a>.</p>
        </div>
      )}

      {/* Song Structure Analysis (if available) */}
      {saveMetadata.songStructure && (
        <SongSectionAnalysis analysis={saveMetadata.songStructure} />
      )}

      {/* Sections */}
      <div className="space-y-4">
        {sections.length > 0 ? sections.map((section, i) => (
          <div key={i} className="bg-card border border-card-border rounded-xl overflow-hidden"
            data-testid={`result-section-${i}`}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-secondary/50">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-primary/50 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="font-bold text-white text-sm tracking-wide uppercase">{section.title}</h3>
              </div>
              {!section.isSceneBreakdown && <CopyButton text={section.content} />}
            </div>
            <div className="px-5 py-4">
              {section.isSceneBreakdown && scenes.length > 0 ? (
                <SceneStudio scenes={scenes} onScenesChange={handleScenesChange} />
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed">{section.content}</pre>
              )}
            </div>
          </div>
        )) : (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
            <pre className="whitespace-pre-wrap font-sans text-sm text-white/70 leading-relaxed">{result}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
