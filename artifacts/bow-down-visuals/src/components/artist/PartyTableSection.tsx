import { useEffect, useState } from "react";
import { Link } from "wouter";
import { LogIn, Swords, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  PARTY_GAME_META,
  parsePartyRooms,
  partyInvitePath,
  partyRoomsForStream,
  partyTableHomeLine,
  partyTableSeatState,
  type PartyOpenRoom,
} from "@/lib/world/games-lobby";

/* ─── Party table at this creator's place (program 2.25) ───────────────
   A party table lives at its host's place, not just on the Kingdom
   Board: this section shows the host's OPEN tables where they live —
   on their public profile, and (stream mode) on the watch page of
   the stream a table is homed to. The data is the public rail
   GET /api/creator-profiles/:slug/party-tables — the same room DTOs
   the board reads, parsed by the same parser.

   "Take a seat" rides the summons flow's own front door,
   /world?party=CODE (partyInvitePath): the world page re-verifies
   the table against the server and walks the visitor to the Marble
   Table — the exact walk a Kingdom Board Join and a pasted invite
   link take. One flow, every door; this section seats nobody
   itself.

   Guests SEE the table (profiles are public storefronts) but the
   seat is members-only, and the door says so: their button is the
   sign-in, with the invite as the post-login return. A full table
   renders full and offers no seat. No open table — or a failed
   read — renders NOTHING: never an empty dressed-up block on a
   creator's page (the LiveNowBadge precedent). */

export default function PartyTableSection({
  slug,
  streamId,
  className,
}: {
  slug: string;
  /** Watch-page mode: only the table homed to this stream shows. */
  streamId?: string;
  className?: string;
}) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<PartyOpenRoom[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/creator-profiles/${encodeURIComponent(slug)}/party-tables`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as unknown;
        if (!cancelled) setRooms(parsePartyRooms(data));
      } catch {
        /* the section just stays hidden — the page itself loaded */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!rooms) return null;
  const shown = streamId ? partyRoomsForStream(rooms, streamId) : rooms;
  if (shown.length === 0) return null;

  return (
    <section
      aria-label="Party table"
      data-testid="profile-party-tables"
      className={className ?? "mx-auto w-full max-w-5xl px-4 pb-6"}
    >
      <div className="flex flex-col gap-3">
        {shown.map((room) => {
          const meta = PARTY_GAME_META[room.game];
          const seatState = partyTableSeatState(room);
          const invite = partyInvitePath(room.code);
          const detail = streamId
            ? "Homed to this stream"
            : partyTableHomeLine(room);
          return (
            <div
              key={room.code}
              data-testid={`profile-party-table-${room.code}`}
              className="flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3"
              style={{
                borderColor: "var(--ap-border, rgba(201,168,76,0.35))",
                backgroundColor: "var(--ap-card, rgba(255,255,255,0.04))",
              }}
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#d4af37]/15"
                aria-hidden="true"
              >
                <Swords className="h-5 w-5 text-[#d4af37]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">
                  {meta.title} — {room.hostName}&rsquo;s table
                </p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs opacity-60">
                  <span>{detail}</span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {room.players}/{meta.seats} seated
                  </span>
                </p>
              </div>
              {seatState === "full" ? (
                <span
                  data-testid={`profile-party-table-full-${room.code}`}
                  className="inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-bold opacity-70"
                  style={{ borderColor: "var(--ap-border, rgba(201,168,76,0.35))" }}
                >
                  Table full
                </span>
              ) : invite && user ? (
                <Link
                  href={invite}
                  data-testid={`profile-party-table-seat-${room.code}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                >
                  <Swords className="h-3.5 w-3.5" /> Take a seat
                </Link>
              ) : invite ? (
                <Link
                  href={`/login?next=${encodeURIComponent(invite)}`}
                  data-testid={`profile-party-table-signin-${room.code}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                >
                  <LogIn className="h-3.5 w-3.5" /> Sign in to take a seat
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
