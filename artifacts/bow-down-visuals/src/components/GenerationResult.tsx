import { useState } from "react";
import { Copy, Check, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

interface Section {
  title: string;
  content: string;
}

function parseSections(raw: string): Section[] {
  const lines = raw.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) sections.push(current);
      current = { title: line.replace(/^## /, "").trim(), content: "" };
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
}

interface GenerationResultProps {
  result: string;
  onReset: () => void;
  saveMetadata: SaveMetadata;
}

export function GenerationResult({ result, onReset, saveMetadata }: GenerationResultProps) {
  const sections = parseSections(result);
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [projectTitle, setProjectTitle] = useState(saveMetadata.songTitle ?? "");

  function handleCopyAll() {
    navigator.clipboard.writeText(result);
    toast({ title: "Copied!", description: "All content copied to clipboard." });
  }

  async function handleSave() {
    if (!user) {
      toast({ title: "Sign in required", description: "Sign in to save your projects.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const sb = getSupabase();
      const { error } = await sb.from("projects").insert({
        user_id: user.id,
        project_type: saveMetadata.projectType,
        artist_name: saveMetadata.artistName ?? null,
        song_title: projectTitle || saveMetadata.songTitle || null,
        genre: saveMetadata.genre ?? null,
        mood: saveMetadata.mood ?? null,
        input_data: saveMetadata.inputData,
        output_data: { result },
      });
      if (error) throw error;
      setSaved(true);
      toast({ title: "Project saved!", description: "Find it in your Dashboard under My Projects." });
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
    <div className="space-y-6" data-testid="generation-result">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-white">Generated Results</h2>
          <p className="text-muted-foreground text-sm mt-1">Copy any section or save the full project.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleCopyAll} className="border-border text-muted-foreground hover:text-white" data-testid="btn-copy-all">
            <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy All
          </Button>
          <Button variant="outline" size="sm" onClick={onReset} className="border-border text-muted-foreground hover:text-white" data-testid="btn-generate-again">
            Generate Again
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
              className="max-w-xs h-8 text-sm"
              data-testid="input-project-title"
            />
          </div>
          <Button
            onClick={handleSave}
            disabled={saving || !user}
            className="purple-glow shrink-0"
            size="sm"
            data-testid="btn-save-project"
          >
            {saving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving...</> : "Save Project"}
          </Button>
        </div>
      ) : (
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 flex items-center gap-3">
          <Check className="h-5 w-5 text-green-400" />
          <p className="text-green-400 font-medium text-sm">Project saved! View it in your Dashboard.</p>
        </div>
      )}

      {/* Sections */}
      <div className="space-y-4">
        {sections.map((section, i) => (
          <div key={i} className="bg-card border border-card-border rounded-xl overflow-hidden" data-testid={`result-section-${i}`}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-secondary/50">
              <h3 className="font-bold text-white text-sm tracking-wide uppercase">{section.title}</h3>
              <CopyButton text={section.content} />
            </div>
            <div className="px-5 py-4">
              <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed">{section.content}</pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
