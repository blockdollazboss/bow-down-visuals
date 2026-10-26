/* ─── SongCredits (Stack-200 N1) ──────────────────────────────────────────
   The ONE credits block every surface renders — docked into the song
   library cards (play surface) and the pre-save/smartlink page (share
   surface); profiles and exports read the same canonical payload.
   Credits come from the server's canonical layer (lib/song-credits):
   recorded once on the song, they follow it everywhere.

   A credit with a profile_path is a LINK to that creator's profile —
   tap a credit, land on the creator. Name-only credits (off-platform
   people, name-only master splits) render as plain text, never a dead
   link. A song with nothing recorded shows the honest empty line.
   Both themes: light renders on the warm ivory card ground, dark on
   the black-marble ground, matching the host surfaces. */

import { Link } from "wouter";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  formatCreditShares,
  shouldShowCredits,
  SONG_CREDITS_EMPTY,
  type PublicSongCredits,
} from "@/lib/song-credits";

export function SongCredits({
  credits,
  ownerHint = false,
  compact = false,
}: {
  credits: PublicSongCredits | null | undefined;
  /** Owner-facing surfaces add the "add them once" hint to the empty state. */
  ownerHint?: boolean;
  compact?: boolean;
}) {
  const isLight = useIsLightTheme();
  if (!shouldShowCredits(credits)) return null;

  const muted = isLight ? "text-[#6B5B2E]" : "text-white/40";
  const body = isLight ? "text-[#2A2118]" : "text-white/85";
  const sub = isLight ? "text-[#8A7648]" : "text-white/50";

  return (
    <div data-testid="song-credits" className={compact ? "mt-2" : "mt-3"}>
      <p className={`text-[11px] font-bold uppercase tracking-widest ${muted}`}>Credits</p>
      {!credits.has_credits ? (
        <p className={`mt-1 text-xs ${sub}`}>
          {credits.empty_message ?? SONG_CREDITS_EMPTY}
          {ownerHint
            ? " Add the writers, producers, featured artists and samples once — they follow this song to every release, share and play surface."
            : ""}
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {credits.credits.map((c) => {
            const shares = formatCreditShares(c.shares);
            const line = (
              <>
                <span className="font-semibold">{c.name}</span>
                <span className={sub}> — {c.role_labels.join(", ")}</span>
                {shares && <span className={sub}> — {shares}</span>}
                {c.detail && <span className={sub}> — {c.detail}</span>}
                {c.inherited && <span className={sub}> · carried from the original song</span>}
              </>
            );
            return (
              <li key={`${c.name}-${c.roles.join("/")}`} className={`text-xs ${body}`}>
                {c.profile_path ? (
                  <Link
                    href={c.profile_path}
                    className="hover:underline decoration-[#C9A84C]/60 underline-offset-2"
                    title={`See ${c.name} on Bow Down Visuals`}
                  >
                    {line}
                  </Link>
                ) : (
                  line
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
