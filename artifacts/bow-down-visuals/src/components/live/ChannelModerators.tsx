import { useEffect, useState } from "react";
import { Loader2, Shield, ShieldPlus, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/social-api";

/* ─── Channel moderators — appointment settings ───────────────────────────
   Lives with the creator's stream/chat settings in the studio. The
   creator appoints moderators from their community by creator
   profile name; appointed mods can delete messages and mute
   chatters in every stream on the channel (never the creator, never
   another mod — the server enforces the same rules). States are
   honest: loading, a real empty state, and server errors surface
   instead of pretending. */

interface ModeratorDto {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  slug: string | null;
  appointedAt: string;
}

type LoadState = "loading" | "ready" | "error";

export default function ChannelModerators({ className = "" }: { className?: string }) {
  const { getAccessToken } = useAuth();
  const [moderators, setModerators] = useState<ModeratorDto[]>([]);
  const [load, setLoad] = useState<LoadState>("loading");
  const [slug, setSlug] = useState("");
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function call(path: string, init?: RequestInit): Promise<{ status: number; json: any }> {
    const res = await apiFetch(getAccessToken, path, init);
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  async function refresh() {
    try {
      const { status, json } = await call("/api/live/moderators");
      if (status !== 200) throw new Error("load failed");
      setModerators((json.moderators ?? []) as ModeratorDto[]);
      setLoad("ready");
    } catch {
      setLoad("error");
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function appoint() {
    const value = slug.trim();
    if (!value || working) return;
    setWorking(true);
    setNote(null);
    try {
      const { status, json } = await call("/api/live/moderators", {
        method: "POST",
        body: JSON.stringify({ profileSlug: value }),
      });
      if (status === 201) {
        setModerators((json.moderators ?? []) as ModeratorDto[]);
        setSlug("");
        setNote("Moderator appointed — they can help run chat on every stream you host.");
      } else {
        setNote((json?.error as string) ?? "That moderator couldn't be appointed.");
      }
    } catch {
      setNote("That moderator couldn't be appointed. Try again.");
    }
    setWorking(false);
  }

  async function remove(userId: string) {
    setWorking(true);
    setNote(null);
    try {
      const { status, json } = await call(`/api/live/moderators/${userId}`, { method: "DELETE" });
      if (status === 200) setModerators((json.moderators ?? []) as ModeratorDto[]);
      else setNote((json?.error as string) ?? "That moderator couldn't be removed.");
    } catch {
      setNote("That moderator couldn't be removed. Try again.");
    }
    setWorking(false);
  }

  return (
    <section
      className={`rounded-2xl border border-[#C9A84C]/25 bg-[#0d0a04] p-4 text-white ${className}`}
      data-testid="channel-moderators"
    >
      <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-[#fbbf24]">
        <Shield className="h-4 w-4" /> Moderators
      </h3>
      <p className="mt-1 text-xs text-white/50">
        Your moderators can remove messages and mute chatters in any of your streams. They can never mute you or
        another moderator.
      </p>

      {load === "loading" && (
        <p className="mt-3 flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin text-amber-400" /> Loading moderators…
        </p>
      )}
      {load === "error" && (
        <div className="mt-3" data-testid="moderators-error">
          <p className="text-sm font-bold">Moderators couldn&rsquo;t load.</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-2 rounded-full bg-amber-400 px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
          >
            Try again
          </button>
        </div>
      )}
      {load === "ready" && (
        <>
          {moderators.length === 0 ? (
            <p className="mt-3 text-sm text-white/45" data-testid="moderators-empty">
              No moderators yet — appoint someone from your community below.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {moderators.map((m) => (
                <li key={m.userId} className="flex items-center gap-2.5" data-testid="moderator-row">
                  {m.avatarUrl ? (
                    <img src={m.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-400/15 text-xs font-bold text-sky-200">
                      {m.displayName[0] ?? "?"}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{m.displayName}</span>
                    {m.slug && <span className="block text-xs text-white/40">@{m.slug}</span>}
                  </span>
                  <span className="rounded-full bg-sky-400/20 px-1.5 py-px text-[10px] font-black uppercase tracking-wide text-sky-200">
                    Mod
                  </span>
                  <button
                    type="button"
                    onClick={() => void remove(m.userId)}
                    disabled={working}
                    className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-bold text-white/60 hover:border-red-400/60 hover:text-red-200 disabled:opacity-40"
                    data-testid="moderator-remove"
                  >
                    <X className="h-3 w-3" /> Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex items-center gap-2">
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="Creator profile name (e.g. mod-friend)"
              aria-label="Moderator's creator profile name"
              className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-white/35 focus:border-[#C9A84C]/70 focus:outline-none"
              data-testid="moderator-slug"
            />
            <button
              type="button"
              onClick={() => void appoint()}
              disabled={working || !slug.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-4 py-2 text-sm font-black text-black transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="moderator-appoint"
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldPlus className="h-4 w-4" />} Appoint
            </button>
          </div>
          {note && (
            <p className="mt-2 text-xs font-semibold text-amber-200/90" role="alert" data-testid="moderator-note">
              {note}
            </p>
          )}
        </>
      )}
    </section>
  );
}
