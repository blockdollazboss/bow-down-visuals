import { plainErrorText } from "../../lib/api-error";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Loader2, Megaphone } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { reachApi } from "@/lib/reach-api";
import { SchedulePremiereForm } from "@/pages/premiere";

/* ── Broadcast channels + premieres (Stack 9 #8/#2), docked ───────────
   A broadcast channel is one-to-many: only the creator posts, members
   read. Open to every creator from level one — no follower-count
   gate. The inbox shows posts from every channel you've joined.

   This panel is the surface's home since Stack 200 Lane C item 2:
   it lived on a standalone /broadcast page that the findability wave
   had already redirected to /go-live, leaving the whole feature
   built, tested and unreachable. The body below is that page's body,
   moved verbatim (per-source settle states included) into the Go
   Live Broadcast tab beside BroadcastStudio — its workflow home in
   the CREATE flow. The /broadcast → /go-live redirect stays, so old
   links land on the hub that now actually hosts the surface.

   Stack 300 broadcast-panel lane (items 72/119 + 75/114): the whole
   panel is catalog-keyed under the `broadcast.*` namespace (English
   source; the 9 non-en catalogs carry it English-verbatim UNREVIEWED
   until real translations land), and the channel actions are honest:
   Join / Leave / Post failures surface a per-channel error through
   the api-error translator (never a raw server string), and a failed
   post keeps the draft — the words are cleared only on success. */

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

export default function BroadcastChannelsPanel() {
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [inbox, setInbox] = useState<Array<{ id: string; channelName: string; body: string; createdAt: string | null; creator: { displayName: string } | null }>>([]);
  /* Per-source states (Stack-28 #26 / A3-F4, dashboard-sections
     pattern): channels and inbox settle independently — one failing
     source must never blank the other or hide the create form. */
  const [channelsState, setChannelsState] = useState<"loading" | "ready" | "error">("loading");
  const [inboxState, setInboxState] = useState<"loading" | "ready" | "error">("loading");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /* Per-channel action failures (Join / Leave / Post), keyed by
     channel id so the error lands on the row that failed. */
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  const clearActionError = useCallback((channelId: string) => {
    setActionErrors((prev) => {
      if (!(channelId in prev)) return prev;
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
  }, []);

  const loadChannels = useCallback(async () => {
    setChannelsState("loading");
    try {
      const ch = await reachApi.broadcastChannels(getAccessToken);
      setChannels(ch.channels as ChannelRow[]);
      setChannelsState("ready");
    } catch {
      setChannelsState("error");
    }
  }, [getAccessToken]);

  const loadInbox = useCallback(async () => {
    setInboxState("loading");
    try {
      const ib = await reachApi.broadcastInbox(getAccessToken);
      setInbox(ib.posts);
      setInboxState("ready");
    } catch {
      setInboxState("error");
    }
  }, [getAccessToken]);

  const loadData = useCallback(async () => {
    await Promise.allSettled([loadChannels(), loadInbox()]);
  }, [loadChannels, loadInbox]);

  useEffect(() => {
    if (user) void loadData();
    else { setChannelsState("ready"); setInboxState("ready"); }
  }, [user, loadData]);

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
        <Megaphone className="h-10 w-10 text-[#C9A84C]/60" />
        <p className="font-bold">{t("broadcast.signInPrompt")}</p>
        <Link href="/login" className="text-sm text-[#e8c86a] underline">{t("broadcast.signIn")}</Link>
      </div>
    );
  }
  const mine = channels.find((c) => c.isOwner);

  return (
    <section className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 md:px-8" aria-label={t("broadcast.ariaLabel")}>
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight"><Megaphone className="h-6 w-6 text-[#e8c86a]" /> {t("broadcast.title")}</h2>
        <p className="mt-1 text-sm text-white/50">{t("broadcast.subtitle")}</p>
      </div>

      {channelsState === "loading" && (
        <div className="flex items-center gap-2 text-sm text-white/40">
          <Loader2 className="h-4 w-4 animate-spin text-amber-400" /> {t("broadcast.loadingChannels")}
        </div>
      )}

      {channelsState === "error" && (
        <div className="rounded-2xl border border-red-900 bg-red-950/30 p-5 text-sm text-red-300" data-testid="broadcast-channels-error">
          {t("broadcast.channelsError")} <button type="button" onClick={() => void loadChannels()} className="font-bold underline">{t("broadcast.tryAgain")}</button>
        </div>
      )}

      {/* The create form keys off the channels source only — and
          stays reachable even when that source failed (the server
          answers the create honestly); an inbox failure can never
          hide it (Stack-28 #26). */}
      {!mine && channelsState !== "loading" && (
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
              setNote(plainErrorText(err, t("broadcast.createFailed")));
            }
          }}
        >
          <h2 className="font-black">{t("broadcast.openChannelTitle")}</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <input aria-label={t("broadcast.channelNameLabel")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("broadcast.channelNameLabel")} className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm focus:border-[#e8c86a] focus:outline-none" />
            <input aria-label={t("broadcast.channelAboutLabel")} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("broadcast.channelAboutLabel")} className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm focus:border-[#e8c86a] focus:outline-none" />
          </div>
          <button type="submit" disabled={!name.trim()} className="mt-3 rounded-full bg-[#e8c86a] px-5 py-2 text-sm font-bold text-black transition enabled:hover:scale-[1.02] disabled:opacity-50">{t("broadcast.openChannelButton")}</button>
          {note && <p className="mt-2 text-sm text-red-300">{note}</p>}
        </form>
      )}

      {channels.length > 0 && (
        <section>
          <h2 className="text-sm font-black uppercase tracking-wider text-white/60">{t("broadcast.channelsHeading")}</h2>
          <ul className="mt-3 space-y-3">
            {channels.map((c) => (
              <li key={c.id} className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-bold">{c.name}</p>
                    <p className="text-xs text-white/40">
                      {t("broadcast.byCreator", { name: c.creator?.displayName ?? t("broadcast.creatorFallback") })} · {c.memberCount} {t(c.memberCount === 1 ? "broadcast.memberOne" : "broadcast.memberOther")}
                      {c.description ? ` · ${c.description}` : ""}
                    </p>
                  </div>
                  {!c.isOwner &&
                    (c.isMember ? (
                      <button type="button" onClick={async () => {
                        try {
                          await reachApi.leaveBroadcast(getAccessToken, c.id);
                          clearActionError(c.id);
                          void loadData();
                        } catch (err) {
                          setActionErrors((prev) => ({ ...prev, [c.id]: plainErrorText(err, t("broadcast.leaveFailed")) }));
                        }
                      }} className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-bold text-white/70">{t("broadcast.leave")}</button>
                    ) : (
                      <button type="button" onClick={async () => {
                        try {
                          await reachApi.joinBroadcast(getAccessToken, c.id);
                          clearActionError(c.id);
                          void loadData();
                        } catch (err) {
                          setActionErrors((prev) => ({ ...prev, [c.id]: plainErrorText(err, t("broadcast.joinFailed")) }));
                        }
                      }} className="rounded-full bg-[#e8c86a] px-4 py-1.5 text-xs font-bold text-black">{t("broadcast.join")}</button>
                    ))}
                </div>
                {actionErrors[c.id] && (
                  <p className="mt-2 text-sm text-red-300" data-testid="broadcast-action-error">{actionErrors[c.id]}</p>
                )}
                {c.isOwner && (
                  <form
                    className="mt-3 flex gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const body = (drafts[c.id] ?? "").trim();
                      if (!body) return;
                      try {
                        await reachApi.postBroadcast(getAccessToken, c.id, body);
                        /* Clear the draft ONLY on a confirmed post —
                           a failure keeps the words and says why. */
                        setDrafts((d) => ({ ...d, [c.id]: "" }));
                        clearActionError(c.id);
                        void loadData();
                      } catch (err) {
                        setActionErrors((prev) => ({ ...prev, [c.id]: plainErrorText(err, t("broadcast.postFailed")) }));
                      }
                    }}
                  >
                    <input aria-label={t("broadcast.postPlaceholder")} value={drafts[c.id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))} placeholder={t("broadcast.postPlaceholder")} className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm focus:border-[#e8c86a] focus:outline-none" />
                    <button type="submit" className="rounded-full bg-[#e8c86a] px-4 py-2 text-xs font-bold text-black">{t("broadcast.post")}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm font-black uppercase tracking-wider text-white/60">{t("broadcast.inboxHeading")}</h2>
        {inboxState === "error" ? (
          <div className="mt-3 rounded-2xl border border-red-900 bg-red-950/30 p-5 text-sm text-red-300" data-testid="broadcast-inbox-error">
            {t("broadcast.inboxError")} <button type="button" onClick={() => void loadInbox()} className="font-bold underline">{t("broadcast.tryAgain")}</button>
          </div>
        ) : inboxState === "loading" ? (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin text-amber-400" /> {t("broadcast.loadingInbox")}</p>
        ) : inbox.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-white/10 bg-[#0d0d0d] p-5 text-sm text-white/40">{t("broadcast.inboxEmpty")}</p>
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
    </section>
  );
}
