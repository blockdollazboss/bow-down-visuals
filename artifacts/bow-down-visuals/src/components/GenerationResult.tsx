import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

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

  return sections.map((s) => ({ ...s, content: s.content.trim() })).filter((s) => s.content.length > 0);
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

interface GenerationResultProps {
  result: string;
  onReset: () => void;
}

export function GenerationResult({ result, onReset }: GenerationResultProps) {
  const sections = parseSections(result);

  function handleCopyAll() {
    navigator.clipboard.writeText(result);
  }

  return (
    <div className="space-y-6" data-testid="generation-result">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-white">Generated Results</h2>
          <p className="text-muted-foreground text-sm mt-1">Copy any section or all results below.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyAll} className="border-border text-muted-foreground hover:text-white" data-testid="btn-copy-all">
            <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy All
          </Button>
          <Button variant="outline" size="sm" onClick={onReset} className="border-border text-muted-foreground hover:text-white" data-testid="btn-generate-again">
            Generate Again
          </Button>
        </div>
      </div>

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
