import { useCallback, useEffect, useState } from "react";
import { Globe2, Loader2, Rocket, CheckCircle2, Circle, Languages } from "lucide-react";
import { Link } from "wouter";

/* ─── Global Drop panel (#165) ─────────────────────────────────────────
   The one-tap RELEASE-level Translate & Dub action, docked in the
   release editor under the Drop Day Kit. Assemble → the five launch
   languages appear as first-class versions of THIS release. Each is
   reviewed by the creator (translated title + destination URL +
   approve) before Publish writes the approved versions into the
   release's smartlink language routing. Nothing is approved or
   translated automatically. ─────────────────────────────────────────── */

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

interface GlobalDropVersion {
  language: string;
  label: string;
  sourceTitle: string;
  translatedTitle: string | null;
  url: string | null;
  status: "draft" | "approved";
  translateLink: string;
}

interface GlobalDropPackage {
  id: string;
  releaseId: string;
  status: "draft" | "active";
  versions: Record<string, GlobalDropVersion>;
  routed?: string[];
  titleOnly?: string[];
}

const LANG_ORDER = ["es", "pt", "fr", "de", "ja"];

export function GlobalDropPanel({ releaseId, authFetch }: { releaseId: string; authFetch: AuthFetch }) {
  const [pkg, setPkg] = useState<GlobalDropPackage | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/global-drop/${releaseId}`);
      if (res.ok) {
        const data = (await res.json()) as GlobalDropPackage;
        setPkg(data);
        setTitles(Object.fromEntries(Object.entries(data.versions).map(([k, v]) => [k, v.translatedTitle ?? ""])));
        setUrls(Object.fromEntries(Object.entries(data.versions).map(([k, v]) => [k, v.url ?? ""])));
      }
    } catch {
      /* no package yet — the assemble state shows */
    } finally {
      setLoaded(true);
    }
  }, [authFetch, releaseId]);

  useEffect(() => { void load(); }, [load]);

  const assemble = async () => {
    setBusy("assemble");
    setError(null);
    try {
      const res = await authFetch("/api/global-drop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ releaseId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not assemble the package");
      setPkg(data as GlobalDropPackage);
      setTitles(Object.fromEntries(Object.entries((data as GlobalDropPackage).versions).map(([k, v]) => [k, v.translatedTitle ?? ""])));
      setUrls(Object.fromEntries(Object.entries((data as GlobalDropPackage).versions).map(([k, v]) => [k, v.url ?? ""])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not assemble the package");
    } finally {
      setBusy(null);
    }
  };

  const review = async (code: string, status: "draft" | "approved") => {
    setBusy(`review-${code}`);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/global-drop/${releaseId}/languages/${code}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          translatedTitle: titles[code]?.trim() ? titles[code].trim() : null,
          url: urls[code]?.trim() ? urls[code].trim() : null,
          status,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not save the review");
      setPkg(data as GlobalDropPackage);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the review");
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    setBusy("publish");
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/global-drop/${releaseId}/publish`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not publish");
      setPkg(data as GlobalDropPackage);
      const routed = (data as GlobalDropPackage).routed ?? [];
      const titleOnly = (data as GlobalDropPackage).titleOnly ?? [];
      setNotice(
        `Published — ${routed.length} language${routed.length === 1 ? "" : "s"} now route from this release's smartlink (${routed.join(", ")}).` +
          (titleOnly.length > 0 ? ` Approved without a URL, so not routed yet: ${titleOnly.join(", ")}.` : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not publish");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="flex items-center gap-2">
        <Globe2 className="h-4 w-4 text-amber-300" />
        <h4 className="text-sm font-bold text-white">Global Drop — five languages, one tap</h4>
        {pkg?.status === "active" && (
          <span className="ml-auto rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
            Published
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-white/40">
        Your release in Spanish, Portuguese, French, German, and Japanese. Assemble the package, run each dub
        in Translate &amp; Dub, review every version yourself, then publish — approved versions route from
        this release&apos;s smartlink by language.
      </p>

      {!loaded ? (
        <p className="mt-3 text-xs text-white/30">Loading…</p>
      ) : !pkg ? (
        <button
          type="button"
          onClick={assemble}
          disabled={busy !== null}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2 text-xs font-bold text-black hover:bg-amber-300 disabled:opacity-50"
        >
          {busy === "assemble" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe2 className="h-4 w-4" />}
          Assemble the five-language package
        </button>
      ) : (
        <div className="mt-3 space-y-2">
          {LANG_ORDER.map((code) => {
            const v = pkg.versions[code];
            if (!v) return null;
            return (
              <div key={code} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center gap-2">
                  {v.status === "approved" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  ) : (
                    <Circle className="h-4 w-4 text-white/30" />
                  )}
                  <span className="text-xs font-bold text-white">{v.label}</span>
                  <span className="text-[11px] text-white/35">from “{v.sourceTitle}”</span>
                  <Link href={v.translateLink} className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300 hover:text-amber-200">
                    <Languages className="h-3.5 w-3.5" /> Translate &amp; Dub
                  </Link>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input aria-label={`Translated title (${v.label})`}
                    value={titles[code] ?? ""}
                    onChange={(e) => setTitles((t) => ({ ...t, [code]: e.target.value }))}
                    placeholder={`Translated title (${v.label})`}
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white placeholder:text-white/25"
                  />
                  <input aria-label="Version URL — where this language's fans land"
                    value={urls[code] ?? ""}
                    onChange={(e) => setUrls((t) => ({ ...t, [code]: e.target.value }))}
                    placeholder="Version URL — where this language's fans land"
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white placeholder:text-white/25"
                  />
                </div>
                <div className="mt-2 flex gap-2">
                  {v.status === "approved" ? (
                    <button
                      type="button"
                      onClick={() => review(code, "draft")}
                      disabled={busy !== null}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/5 disabled:opacity-50"
                    >
                      {busy === `review-${code}` ? "Saving…" : "Back to draft"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => review(code, "approved")}
                      disabled={busy !== null}
                      className="rounded-lg bg-emerald-400/90 px-3 py-1.5 text-[11px] font-bold text-black hover:bg-emerald-300 disabled:opacity-50"
                    >
                      {busy === `review-${code}` ? "Saving…" : "Save & approve"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <button
            type="button"
            onClick={publish}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2 text-xs font-bold text-black hover:bg-amber-300 disabled:opacity-50"
          >
            {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Publish approved versions to the smartlink
          </button>
        </div>
      )}

      {notice && <p className="mt-3 text-xs text-emerald-300">{notice}</p>}
      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
    </div>
  );
}
