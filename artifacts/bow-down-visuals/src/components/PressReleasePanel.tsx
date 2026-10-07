import { useState } from "react";
import {
  Loader2, Sparkles, Copy, Check, Download, Plus, Trash2, FileText, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";

/* ─── AI Press Release Generator panel ──────────────────────────────────
   Lives inside the Press Kit page (/press-kit) as a tab — no new page.
   Chain: generate (100 Visual Bucs) → copy / download .txt / save into the
   selected press kit (press_releases, free to edit). */

const RELEASE_COST = 100;

export interface PressReleaseKit {
  id: string;
  artist_name: string;
  press_releases?: PressKitRelease[];
}

export interface PressKitRelease {
  id: string;
  headline: string;
  body: string;
  announcementType: string;
  social: string;
  createdAt: string;
}

interface GeneratedRelease {
  headline: string;
  dateline: string;
  lede: string;
  body: string[];
  quote: string;
  boilerplate: string;
  contactBlock: string[];
  social: string;
}

const ANNOUNCEMENT_TYPES = ["single", "album", "tour", "launch", "milestone"] as const;

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-[#d4af37]/60 focus:outline-none";

function formatReleaseText(r: GeneratedRelease, artistName: string): string {
  const lines = [
    "FOR IMMEDIATE RELEASE",
    "",
    r.headline,
    "",
    r.dateline ? `${r.dateline} — ${r.lede}` : r.lede,
    "",
    ...r.body.flatMap((p) => [p, ""]),
    r.quote ? [`"${r.quote}" — ${artistName}`, ""] : [],
    r.boilerplate ? [`About ${artistName}`, r.boilerplate, ""] : [],
    "###",
    ...r.contactBlock,
  ].flat();
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export default function PressReleasePanel({
  kit,
  onKitUpdated,
}: {
  kit: PressReleaseKit | null;
  onKitUpdated: (kit: PressReleaseKit) => void;
}) {
  const { confirmedFetch } = useConfirmedApi();
  const { t } = useTranslation();
  const p = (k: string, opts?: { [key: string]: string | number }) =>
    t(`press-kit.pressRelease.${k}`, opts);

  /* form */
  const [announcementType, setAnnouncementType] = useState<(typeof ANNOUNCEMENT_TYPES)[number]>("single");
  const [artistName, setArtistName] = useState(kit?.artist_name ?? "");
  const [topic, setTopic] = useState("");
  const [keyFacts, setKeyFacts] = useState<string[]>([""]);
  const [quote, setQuote] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [datelineCity, setDatelineCity] = useState("");

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [release, setRelease] = useState<GeneratedRelease | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedSocial, setCopiedSocial] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const savedReleases = kit?.press_releases ?? [];
  const cleanFacts = () => keyFacts.map((f) => f.trim()).filter(Boolean);

  async function handleGenerate() {
    setError(null);
    setOutOfCredits(false);
    if (!artistName.trim()) { setError(p("errors.missingArtist")); return; }
    if (topic.trim().length < 10) { setError(p("errors.topicTooShort")); return; }
    if (cleanFacts().length === 0) { setError(p("errors.missingFacts")); return; }
    setGenerating(true);
    try {
      const res = await confirmedFetch("/api/press-release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        overrideCost: RELEASE_COST,
        overrideFeature: p("confirmFeature"),
        body: JSON.stringify({
          announcementType,
          topic: topic.trim(),
          artistName: artistName.trim(),
          keyFacts: cleanFacts(),
          quote: quote.trim() || undefined,
          contactInfo: {
            name: contactName.trim(),
            email: contactEmail.trim(),
            phone: contactPhone.trim(),
          },
          datelineCity: datelineCity.trim() || undefined,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = await res.json();
      if (res.status === 402) { setOutOfCredits(true); return; }
      if (!res.ok) { setError(data.message || data.error || p("errors.generationFailed")); return; }
      setRelease(data.release as GeneratedRelease);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError(p("errors.network"));
    } finally {
      setGenerating(false);
    }
  }

  function copyText(text: string, set: (v: boolean) => void) {
    navigator.clipboard.writeText(text).catch(() => {});
    set(true);
    setTimeout(() => set(false), 2000);
  }

  function downloadRelease(headline: string, body: string) {
    const slug = headline.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "press-release";
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleAddToPressKit() {
    if (!kit || !release) return;
    setSaving(true);
    setError(null);
    try {
      const entry: PressKitRelease = {
        id: `pr-${Date.now()}`,
        headline: release.headline,
        body: formatReleaseText(release, artistName.trim()),
        announcementType,
        social: release.social,
        createdAt: new Date().toISOString(),
      };
      const res = await fetch(`/api/press-kit/${kit.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ press_releases: [...savedReleases, entry] }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || data.error || p("errors.saveFailed")); return; }
      onKitUpdated({ ...kit, press_releases: [...savedReleases, entry] });
      setRelease(null);
    } catch {
      setError(p("errors.network"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRelease(id: string) {
    if (!kit || !window.confirm(p("confirmDelete"))) return;
    try {
      const next = savedReleases.filter((r) => r.id !== id);
      const res = await fetch(`/api/press-kit/${kit.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ press_releases: next }),
      });
      if (!res.ok) return;
      onKitUpdated({ ...kit, press_releases: next });
    } catch { /* non-fatal */ }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <FileText className="h-5 w-5 text-[#d4af37]" /> {p("title")}
        </h2>
        <p className="text-sm text-white/50 mt-1 max-w-2xl">{p("description")}</p>
      </div>

      {outOfCredits && <OutOfCredits />}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      {/* ── result ── */}
      {release && (
        <div className="rounded-2xl border border-[#d4af37]/40 bg-[#d4af37]/[0.04] p-6 md:p-8">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#d4af37]">{p("resultTitle")}</span>
            <Button size="sm" variant="ghost" onClick={() => setRelease(null)} className="text-white/40 hover:text-white text-xs">
              {p("dismiss")}
            </Button>
          </div>

          <p className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">FOR IMMEDIATE RELEASE</p>
          <h3 className="text-2xl font-bold mb-3">{release.headline}</h3>
          <p className="text-sm text-white/80 leading-relaxed mb-4">
            {release.dateline ? <><span className="font-semibold">{release.dateline}</span> — </> : null}
            {release.lede}
          </p>
          {release.body.map((para, i) => (
            <p key={i} className="text-sm text-white/70 leading-relaxed mb-3">{para}</p>
          ))}
          {release.quote && (
            <blockquote className="border-l-2 border-[#d4af37]/60 pl-4 my-4 text-sm">
              <p className="text-white/85 italic">“{release.quote}”</p>
              <cite className="text-white/40 not-italic">— {artistName.trim()}</cite>
            </blockquote>
          )}
          {release.boilerplate && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-1">
                {p("aboutLabel")} {artistName.trim()}
              </p>
              <p className="text-sm text-white/70 leading-relaxed">{release.boilerplate}</p>
            </div>
          )}
          {release.contactBlock.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-1">###</p>
              {release.contactBlock.map((line, i) => (
                <p key={i} className="text-sm text-white/60">{line}</p>
              ))}
            </div>
          )}

          <div className="mt-6 rounded-xl border border-white/10 bg-black/40 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#d4af37]">{p("socialLabel")}</span>
              <span className="text-xs text-white/40">{release.social.length}/280</span>
            </div>
            <p className="text-sm text-white/80">{release.social}</p>
            <Button size="sm" variant="outline" onClick={() => copyText(release.social, setCopiedSocial)}
                    className="border-white/15 mt-3 text-xs">
              {copiedSocial ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
              {copiedSocial ? p("copied") : p("copySocial")}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 mt-6">
            <Button size="sm" variant="outline" onClick={() => copyText(formatReleaseText(release, artistName.trim()), setCopied)}
                    className="border-white/15">
              {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
              {copied ? p("copied") : p("copyFull")}
            </Button>
            <Button size="sm" variant="outline"
                    onClick={() => downloadRelease(release.headline, formatReleaseText(release, artistName.trim()))}
                    className="border-white/15">
              <Download className="h-4 w-4 mr-1" /> {p("download")}
            </Button>
            <Button size="sm" onClick={handleAddToPressKit} disabled={!kit || saving}
                    className="bg-[#d4af37] text-black hover:bg-[#e5c158] font-semibold">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              {p("addToPressKit")}
            </Button>
          </div>
          {!kit && (
            <p className="text-xs text-white/40 mt-3">{p("noKitHint")}</p>
          )}
        </div>
      )}

      {/* ── form ── */}
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-white/60 mb-1 block">{p("form.announcementType")}</label>
          <select value={announcementType} onChange={(e) => setAnnouncementType(e.target.value as typeof announcementType)}
                  className={`${inputCls} bg-black`}>
            {ANNOUNCEMENT_TYPES.map((tId) => (
              <option key={tId} value={tId}>{p(`types.${tId}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-white/60 mb-1 block">{p("form.artistName")}</label>
          <Input value={artistName} onChange={(e) => setArtistName(e.target.value)}
                 placeholder={p("placeholders.artistName")} className={inputCls} />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-white/60 mb-1 block">{p("form.topic")}</label>
        <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={4}
                  placeholder={p("placeholders.topic")} className={inputCls} />
      </div>

      <div>
        <label className="text-xs font-medium text-white/60 mb-2 block">{p("form.keyFacts")}</label>
        {keyFacts.map((f, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <Input value={f} onChange={(e) => setKeyFacts((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
                   placeholder={p("placeholders.fact")} className={inputCls} />
            <Button size="sm" variant="ghost" onClick={() => setKeyFacts((l) => l.filter((_, j) => j !== i))}
                    className="text-white/40 hover:text-red-300 shrink-0"><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setKeyFacts((l) => [...l, ""])}
                className="border-white/15 text-xs"><Plus className="h-3 w-3 mr-1" /> {p("form.addFact")}</Button>
      </div>

      <div>
        <label className="text-xs font-medium text-white/60 mb-1 block">{p("form.quote")} <span className="text-white/30">({p("optional")})</span></label>
        <Textarea value={quote} onChange={(e) => setQuote(e.target.value)} rows={2}
                  placeholder={p("placeholders.quote")} className={inputCls} />
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <label className="text-xs font-medium text-white/60 mb-1 block">{p("form.contactName")}</label>
          <Input value={contactName} onChange={(e) => setContactName(e.target.value)}
                 placeholder={p("placeholders.contactName")} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-white/60 mb-1 block">{p("form.contactEmail")}</label>
          <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                 placeholder={p("placeholders.contactEmail")} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-medium text-white/60 mb-1 block">{p("form.contactPhone")} <span className="text-white/30">({p("optional")})</span></label>
          <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                 placeholder={p("placeholders.contactPhone")} className={inputCls} />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-white/60 mb-1 block">{p("form.datelineCity")} <span className="text-white/30">({p("optional")})</span></label>
        <Input value={datelineCity} onChange={(e) => setDatelineCity(e.target.value)}
               placeholder={p("placeholders.datelineCity")} className={`${inputCls} max-w-sm`} />
      </div>

      <div>
        <Button onClick={handleGenerate} disabled={generating}
                className="bg-[#d4af37] text-black hover:bg-[#e5c158] font-semibold">
          {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          {p("generateRelease", { count: RELEASE_COST })}
        </Button>
        <p className="text-xs text-white/30 mt-2">{p("costNote")}</p>
      </div>

      {/* ── saved releases ── */}
      {kit && savedReleases.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37] mb-3">
            {p("savedTitle", { name: kit.artist_name })}
          </h3>
          <div className="space-y-2">
            {savedReleases.map((r) => (
              <div key={r.id} className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                <button onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                        className="w-full flex items-center justify-between gap-2 text-left">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{r.headline}</div>
                    <div className="text-xs text-white/40">
                      {p(`types.${r.announcementType}`)} · {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-white/40 shrink-0 transition-transform ${expandedId === r.id ? "rotate-180" : ""}`} />
                </button>
                {expandedId === r.id && (
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <pre className="text-xs text-white/70 whitespace-pre-wrap font-sans leading-relaxed max-h-64 overflow-y-auto">{r.body}</pre>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <Button size="sm" variant="outline" onClick={() => copyText(r.body, setCopied)}
                              className="border-white/15 text-xs">
                        {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                        {copied ? p("copied") : p("copyFull")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => downloadRelease(r.headline, r.body)}
                              className="border-white/15 text-xs">
                        <Download className="h-3 w-3 mr-1" /> {p("download")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleDeleteRelease(r.id)}
                              className="border-red-500/30 text-red-300 hover:bg-red-500/10 text-xs">
                        <Trash2 className="h-3 w-3 mr-1" /> {p("delete")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
