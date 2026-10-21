import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, Megaphone } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import { reachApi } from "@/lib/reach-api";
import { SchedulePremiereForm } from "@/pages/premiere";

/* ── /broadcast — broadcast channels + premieres (Stack 9 #8/#2) ────────
   A broadcast channel is one-to-many: only the creator posts, members
   read. Open to every creator from level one — no follower-count
   gate. The inbox shows posts from every channel you've joined. */

interface ChannelRow {
  id: string;
  name: string;
  description: string;
  profileId: string;
  memberCount: number;
  isMember: boolean;
  isOwner: boolean;
  creator: { slug: string; displayName: string } | null;
}

export default function BroadcastPage() {
  const { user, getAccessToken } = useAuth();
  usePageTitle("Broadcast", "Broadcast channels and premieres on Bow Down Visuals.");
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [inbox, setInbox] = useState<Array<{ id: string; channelName: string; body: string; createdAt: string | null; creator: { displayName: string } | null }>>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    try {
      const [ch, ib] = await Promise.all([reachApi.broadcastChannels(getAccessToken), reachApi.broadcastInbox(getAccessToken)]);
      setChannels(ch.channels as ChannelRow[]);
      setInbox(ib.posts);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (user) void loadData();
    else setLoadState("ready");
  }, [user, loadData]);

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-black p-6 text-center text-white">
        <Megaphone className="h-10 w-10 text-[#C9A84C]/60" />
        <p className="font-bold">Sign in to use broadcast channels.</p>
        <Link href="/login" className="text-sm text-[#e8c86a] underline">Sign in</Link>
      </div>
    );
  }
  if (loadState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
      </div>
    );
  }

  const mine = channels.find((c) => c.isOwner);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 md:px-8">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight"><Megaphone className="h-6 w-6 text-[#e8c86a]" /> Broadcast</h1>
          <p className="mt-1 text-sm text-white/50">Your one-to-many channel: you post, your people read. Open to every creator from day one.</p>
        </div>

        {loadState === "error" && (
          <div className="rounded-2xl border border-red-900 bg-red-950/30 p-5 text-sm text-red-300">
            Broadcast couldn't load. <button type="button" onClick={() => void loadData()} className="font-bold underline">Try again</button>
          </div>
        )}

        {!mine && loadState === "ready" && (
          <form
            className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setNote(null);
              try {
                await reachApi.createBroadcastChannel(getAccessToken, name.trim(), description.trim());
                setName("");
                setDescription("");
                await loadData();
              } catch (err) {
                setNote(err instanceof Error ? err.message : "Your channel couldn't be opened.");
              }
            }}
          >
            <h2 className="font-black">Open your broadcast channel</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Channel name" className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm focus:border-[#e8c86a] focus:outline-none" />
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is it about? (optional)" className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm focus:border-[#e8c86a] focus:outline-none" />
            </div>
            <button type="submit" disabled={!name.trim()} className="mt-3 rounded-full bg-[#e8c86a] px-5 py-2 text-sm font-bold text-black transition enabled:hover:scale-[1.02] disabled:opacity-50">Open channel</button>
            {note && <p className="mt-2 text-sm text-red-300">{note}</p>}
          </form>
        )}

        {channels.length > 0 && (
          <section>
            <h2 className="text-sm font-black uppercase tracking-wider text-white/60">Channels</h2>
            <ul className="mt-3 space-y-3">
              {channels.map((c) => (
                <li key={c.id} className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-bold">{c.name}</p>
                      <p className="text-xs text-white/40">
                        by {c.creator?.displayName ?? "Creator"} · {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                        {c.description ? ` · ${c.description}` : ""}
                      </p>
                    </div>
                    {!c.isOwner &&
                      (c.isMember ? (
                        <button type="button" onClick={async () => { await reachApi.leaveBroadcast(getAccessToken, c.id).catch(() => undefined); void loadData(); }} className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-bold text-white/70">Leave</button>
                      ) : (
                        <button type="button" onClick={async () => { await reachApi.joinBroadcast(getAccessToken, c.id).catch(() => undefined); void loadData(); }} className="rounded-full bg-[#e8c86a] px-4 py-1.5 text-xs font-bold text-black">Join</button>
                      ))}
                  </div>
                  {c.isOwner && (
                    <form
                      className="mt-3 flex gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const body = (drafts[c.id] ?? "").trim();
                        if (!body) return;
                        await reachApi.postBroadcast(getAccessToken, c.id, body).catch(() => undefined);
                        setDrafts((d) => ({ ...d, [c.id]: "" }));
                        void loadData();
                      }}
                    >
                      <input value={drafts[c.id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))} placeholder="Broadcast something to your members…" className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm focus:border-[#e8c86a] focus:outline-none" />
                      <button type="submit" className="rounded-full bg-[#e8c86a] px-4 py-2 text-xs font-bold text-black">Post</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="text-sm font-black uppercase tracking-wider text-white/60">Your broadcast inbox</h2>
          {inbox.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-white/10 bg-[#0d0d0d] p-5 text-sm text-white/40">Nothing here yet — join a channel above and its posts land in this inbox.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {inbox.map((p) => (
                <li key={p.id} className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-4">
                  <p className="text-xs text-[#e8c86a]">{p.channelName}{p.creator ? ` · ${p.creator.displayName}` : ""}{p.createdAt ? ` · ${new Date(p.createdAt).toLocaleString()}` : ""}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-white/85">{p.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <SchedulePremiereForm />
      </div>
    </div>
  );
}
