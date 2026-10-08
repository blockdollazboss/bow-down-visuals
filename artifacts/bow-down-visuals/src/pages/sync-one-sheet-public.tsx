import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { useTranslation } from "react-i18next";
import { Loader2, Link2Off, Check, Mail, Music2, Disc3 } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Public sync one-sheet ───────────────────────────────────────────────
   /sync-one-sheet/:token — no login required. A music supervisor who gets
   the share link sees the creator's sync one-sheet: logline, mood tags,
   BPM/key, "sounds like", comparable artists, sync placement ideas,
   instrumental/stems availability, and contact info.

   Shared URLs carry ?ref=CODE (AppShell captures it for the referral loop)
   — every one-sheet view is a potential signup that credits the creator. */

interface PublicOneSheetContent {
  logline: string;
  moodTags: string[];
  soundsLike: string;
  comparableArtists: string[];
  syncUses: string[];
  pitchEmail: { subject: string; body: string };
  licensingNotes: string;
  disclaimer: string;
}

interface PublicOneSheet {
  songTitle: string;
  artistName?: string | null;
  content: PublicOneSheetContent;
  moodTags: string[];
  bpm?: string | null;
  musicalKey?: string | null;
  comparableArtists: string[];
  soundsLike?: string | null;
  instrumentalAvailable: boolean;
  stemsAvailable: boolean;
  contactName?: string | null;
  contactEmail?: string | null;
}

export default function SyncOneSheetPublic() {
  const { t } = useTranslation();
  const [, params] = useRoute("/sync-one-sheet/:token");
  const token = params?.token ?? "";
  const [sheet, setSheet] = useState<PublicOneSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sync-pitch/public/${encodeURIComponent(token)}`);
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && json.oneSheet) setSheet(json.oneSheet);
        else setNotFound(true);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  usePageTitle(
    sheet ? `${sheet.songTitle} — Sync One-Sheet | Bow Down Visuals` : t("syncPitch.publicTitle"),
    sheet ? `${sheet.content?.logline ?? ""} Sync licensing one-sheet for "${sheet.songTitle}".` : t("syncPitch.publicDescription"),
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  if (notFound || !sheet) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black px-5 text-center text-white">
        <Link2Off className="h-10 w-10 text-white/25" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-black">{t("syncPitch.publicNotFound")}</h1>
        <p className="mt-2 max-w-sm text-sm text-white/50">{t("syncPitch.publicNotFoundDesc")}</p>
        <a
          href="/"
          className="mt-6 rounded-xl bg-primary px-6 py-3 text-sm font-black text-black transition hover:brightness-110"
        >
          {t("syncPitch.publicHome")}
        </a>
      </div>
    );
  }

  const c = sheet.content;
  return (
    <div className="min-h-screen bg-black text-white">
      <main className="relative mx-auto max-w-3xl px-5 pb-24 pt-14">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Disc3 className="h-3 w-3" aria-hidden="true" /> {t("syncPitch.publicBadge")}
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            {sheet.songTitle}
          </h1>
          {sheet.artistName && (
            <p className="mt-2 text-lg font-semibold text-white/60">{sheet.artistName}</p>
          )}
        </div>

        <div className="relative mt-8 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
          <p className="border-l-2 border-primary/60 pl-4 text-lg italic leading-relaxed text-white/85">
            “{c.logline}”
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: t("syncPitch.statBpm"), value: sheet.bpm || "—" },
              { label: t("syncPitch.statKey"), value: sheet.musicalKey || "—" },
              { label: t("syncPitch.statInstrumental"), value: sheet.instrumentalAvailable ? t("syncPitch.yes") : t("syncPitch.no") },
              { label: t("syncPitch.statStems"), value: sheet.stemsAvailable ? t("syncPitch.yes") : t("syncPitch.no") },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">{s.label}</p>
                <p className="mt-1 text-sm font-semibold text-white">{s.value}</p>
              </div>
            ))}
          </div>

          {sheet.moodTags.length > 0 && (
            <div className="mt-5">
              <div className="flex flex-wrap gap-2">
                {sheet.moodTags.map((m) => (
                  <span key={m} className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}

          {c.soundsLike && (
            <p className="mt-5 text-sm text-white/80">
              <span className="font-bold text-white/50">{t("syncPitch.soundsLikeLabel")}: </span>
              {c.soundsLike}
            </p>
          )}

          {c.syncUses.length > 0 && (
            <div className="mt-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("syncPitch.syncUsesLabel")}</p>
              <ul className="mt-2 space-y-1.5">
                {c.syncUses.map((u, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                    {u}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(sheet.contactName || sheet.contactEmail) && (
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">{t("syncPitch.contactLabel")}</p>
              <p className="mt-1.5 flex items-center gap-2 text-sm text-white/80">
                <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
                {sheet.contactName}
                {sheet.contactEmail ? <span className="text-white/50"> · {sheet.contactEmail}</span> : null}
              </p>
            </div>
          )}
        </div>

        <p className="relative mt-6 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4 text-center text-[13px] leading-relaxed text-amber-200/80">
          {c.disclaimer}
        </p>

        {/* viral surface: every supervisor view can become a signup */}
        <div className="relative mt-8 rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 text-center">
          <p className="flex items-center justify-center gap-2 text-sm font-black text-white">
            <Music2 className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("syncPitch.publicCta")}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/55">
            {t("syncPitch.publicCtaDesc")}
          </p>
          <a
            href={window.location.search || "/"}
            className="mt-4 inline-block rounded-xl bg-primary px-6 py-3 text-sm font-black text-black transition hover:brightness-110"
          >
            {t("syncPitch.publicCtaButton")}
          </a>
          <p className="mt-3 text-[11px] uppercase tracking-widest text-white/30">
            {t("syncPitch.madeWith")}
          </p>
        </div>
      </main>
    </div>
  );
}
