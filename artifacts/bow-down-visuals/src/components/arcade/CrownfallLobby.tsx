/**
 * CrownfallLobby — Crownfall Run ONLINE (owner directive, Nov 10
 * 2026: "Crownfall Run should be multiplayer online 30 rooms max").
 *
 * The Arcade's co-op front door: the open-room list (name, Kings
 * seated, current floor), Create Room, Join Room (button or code),
 * the waiting room, and — once the host starts — the game itself,
 * played through the CrownfallClient bridge (lib/crownfall-net.ts)
 * into the SAME CrownfallRunGame the solo mode uses.
 *
 * Party rules, stated on the tin because they differ from solo:
 * the floor is shared and so is the fighting; coins land in your
 * OWN purse; the golden door opens for the whole party at once and
 * the party descends together; a fallen King spectates and rises
 * at the next floor at half health; the world does not pause.
 * Scores submit through the existing arcade score route with the
 * room code attached — the server validates them against its own
 * run receipt, not against anything this page claims.
 *
 * Members only (multiplayer is members' play — the World access
 * law). No Visual Bucs anywhere: no entry fee, no wager, no prize.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Crown, LogOut, Play, Plus, RefreshCw, Swords, Users } from "lucide-react";
import CrownfallRunGame from "./CrownfallRunGame";
import {
  CrownfallClient,
  crownfallOverlay,
  defaultCrownfallSocketUrl,
  isCrownfallRoomCode,
  normalizeCrownfallCode,
  type CrownfallRoomSummary,
  type CrownfallSocketLike,
} from "@/lib/crownfall-net";
import { useAuth } from "@/contexts/AuthContext";
import type { ArcadeRunResult } from "@/lib/arcade-games";

const MAX_ROOMS = 30;

type RoomListItem = CrownfallRoomSummary & { hostName: string };

export default function CrownfallLobby({ light }: { light: boolean }) {
  const { user, getAccessToken } = useAuth();
  const [rooms, setRooms] = useState<RoomListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [roomName, setRoomName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [client, setClient] = useState<CrownfallClient | null>(null);
  const [, setUiTick] = useState(0);
  const [inRun, setInRun] = useState(false);
  const [scoreLine, setScoreLine] = useState<string | null>(null);
  const clientRef = useRef<CrownfallClient | null>(null);

  const panel = light
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const ink = light ? "text-[#2A1E07]" : "text-white";
  const muted = light ? "text-[#6B5B36]" : "text-white/55";
  const rowBg = light ? "bg-white/50" : "bg-white/5";
  const goldBtn =
    "inline-flex items-center gap-1.5 rounded-lg bg-[#C9A84C] px-3.5 py-2 text-sm font-black text-[#2A1E07] transition hover:bg-[#dcbc60] disabled:cursor-not-allowed disabled:opacity-50";
  const ghostBtn = `inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
    light ? "border-[#C9A84C]/50 text-[#2A1E07] hover:bg-white/60" : "border-white/20 text-white hover:bg-white/10"
  }`;
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm font-semibold outline-none ${
    light
      ? "border-[#C9A84C]/40 bg-white/70 text-[#2A1E07] placeholder:text-[#6B5B36]/60"
      : "border-white/15 bg-black/40 text-white placeholder:text-white/35"
  }`;

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const loadRooms = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/arcade/crownfall/rooms", { headers });
      const data = (await res.json().catch(() => ({}))) as {
        rooms?: CrownfallRoomSummary[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not load the rooms");
      setRooms(
        (data.rooms ?? []).map((r) => ({
          ...r,
          hostName: r.players.find((p) => p.isHost)?.displayName ?? "A creator",
        })),
      );
      setListError(null);
    } catch (err) {
      setRooms([]);
      setListError(err instanceof Error ? err.message : "Could not load the rooms");
    }
  }, [authHeaders]);

  useEffect(() => {
    if (user && !client) void loadRooms();
  }, [user, client, loadRooms]);

  const enterRoom = useCallback(
    (code: string) => {
      const c = new CrownfallClient({
        getAccessToken,
        socketUrl: (token, roomCode) => defaultCrownfallSocketUrl(window.location, token, roomCode),
        openSocket: (url) => new WebSocket(url) as unknown as CrownfallSocketLike,
      });
      c.onUpdate = () => setUiTick((n) => n + 1);
      clientRef.current = c;
      setClient(c);
      setInRun(false);
      setScoreLine(null);
      setActionError(null);
      void c.connect(code);
    },
    [getAccessToken],
  );

  const leaveRoom = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setClient(null);
    setInRun(false);
    setScoreLine(null);
  }, []);

  /* The host started (or a reconnect landed us in) a live run: mount
     the game. It stays mounted after the run ends so the death
     summary — and its score submission — complete on screen. */
  useEffect(() => {
    if (client && client.started) setInRun(true);
  }, [client, client?.started, client?.roomPhase]);

  /* Leaving the page leaves the room. */
  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  const createRoom = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/arcade/crownfall/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ name: roomName.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        room?: CrownfallRoomSummary;
        error?: string;
      };
      if (!res.ok || !data.room) throw new Error(data.error ?? "Could not open the room");
      setRoomName("");
      enterRoom(data.room.code);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not open the room");
    } finally {
      setBusy(false);
    }
  }, [authHeaders, roomName, enterRoom]);

  const submitMpScore = useCallback(
    async (result: ArcadeRunResult) => {
      const c = clientRef.current;
      if (!c) return;
      try {
        const headers = await authHeaders();
        const res = await fetch("/api/arcade/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ ...result, roomId: c.code, partySize: c.players.length }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "save failed");
        setScoreLine("Party score saved to the Crownfall board.");
      } catch {
        setScoreLine("That party score didn't save — the run still counted here.");
      }
    },
    [authHeaders],
  );

  /* ── guests: multiplayer is members' play ── */
  if (!user) {
    return (
      <section className={`mt-6 rounded-2xl border p-5 md:p-6 ${panel}`}>
        <h2 className={`inline-flex items-center gap-2 text-lg font-black ${ink}`}>
          <Swords className="h-5 w-5 text-[#C9A84C]" /> Crownfall Run — Online
        </h2>
        <p className={`mt-1 text-sm ${muted}`}>
          Descend together: up to four Kings share the floor, fight the same invaders, and race
          for their own coin purses. Multiplayer is for members — sign in to open a room or join one.
        </p>
      </section>
    );
  }

  const overlay = client ? crownfallOverlay(client.status) : null;

  return (
    <section className={`mt-6 rounded-2xl border p-5 md:p-6 ${panel}`}>
      <h2 className={`inline-flex items-center gap-2 text-lg font-black ${ink}`}>
        <Swords className="h-5 w-5 text-[#C9A84C]" /> Crownfall Run — Online
      </h2>
      <p className={`mb-4 mt-1 text-sm ${muted}`}>
        Up to four Kings share the floor and fight the same invaders — coins land in your own
        purse, the golden door opens for everyone at once, and the party descends together. Fall,
        and you spectate until the next floor, where you rise at half health. The world doesn't
        pause in a party run.
      </p>

      {!client && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-52 flex-1">
              <label className={`mb-1 block text-xs font-bold ${muted}`}>Open a room</label>
              <input
                className={inputCls}
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Room name (or leave it to your name)"
                maxLength={80}
              />
            </div>
            <button type="button" className={goldBtn} onClick={() => void createRoom()} disabled={busy}>
              <Plus className="h-4 w-4" /> Create Room
            </button>
            <div className="min-w-40">
              <label className={`mb-1 block text-xs font-bold ${muted}`}>Join by code</label>
              <input
                className={inputCls}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="ABC234"
                maxLength={6}
              />
            </div>
            <button
              type="button"
              className={ghostBtn}
              disabled={!isCrownfallRoomCode(joinCode)}
              onClick={() => enterRoom(normalizeCrownfallCode(joinCode))}
            >
              Join Room
            </button>
            <button type="button" className={ghostBtn} onClick={() => void loadRooms()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>

          {actionError && <p className="mt-3 text-sm font-bold text-[#e0654f]">{actionError}</p>}

          <div className="mt-4">
            {rooms === null ? (
              <p className={`text-sm ${muted}`}>Loading rooms…</p>
            ) : listError ? (
              <p className="text-sm font-bold text-[#e0654f]">{listError}</p>
            ) : rooms.length === 0 ? (
              <p className={`text-sm ${muted}`}>
                No open rooms right now — create the first one and share its code.
              </p>
            ) : (
              <ul className="space-y-2">
                {rooms.map((r) => (
                  <li
                    key={r.code}
                    className={`flex flex-wrap items-center gap-3 rounded-xl px-3.5 py-2.5 ${rowBg}`}
                  >
                    <div className="min-w-40 flex-1">
                      <p className={`text-sm font-black ${ink}`}>{r.name}</p>
                      <p className={`text-xs ${muted}`}>
                        Hosted by {r.hostName} · Floor {r.depth} · Code {r.code}
                      </p>
                    </div>
                    <span className={`inline-flex items-center gap-1 text-sm font-bold ${ink}`}>
                      <Users className="h-4 w-4 text-[#C9A84C]" /> {r.players.length}/{r.maxPlayers}
                    </span>
                    <button
                      type="button"
                      className={goldBtn}
                      disabled={r.players.length >= r.maxPlayers}
                      onClick={() => enterRoom(r.code)}
                    >
                      {r.players.length >= r.maxPlayers ? "Room Full" : "Join Room"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {rooms !== null && rooms.length >= MAX_ROOMS && (
              <p className={`mt-2 text-xs ${muted}`}>
                All {MAX_ROOMS} rooms are live right now — join one above, or try again in a bit.
              </p>
            )}
          </div>
        </>
      )}

      {client && (
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className={`text-base font-black ${ink}`}>{client.roomName || "Crownfall room"}</p>
            <span className={`text-xs font-bold ${muted}`}>Code {client.code}</span>
            <span className={`text-xs font-bold ${muted}`}>{inRun ? "Run live" : "Lobby"}</span>
            <button type="button" className={`${ghostBtn} ml-auto`} onClick={leaveRoom}>
              <LogOut className="h-4 w-4" /> Leave room
            </button>
          </div>

          {overlay === "connecting" && <p className={`mt-3 text-sm ${muted}`}>Connecting to the room…</p>}
          {overlay === "room-full" && (
            <p className="mt-3 text-sm font-bold text-[#e0654f]">
              That room is full — four Kings are already seated. <button type="button" className="underline" onClick={leaveRoom}>Back to the rooms</button>
            </p>
          )}
          {overlay === "no-room" && (
            <p className="mt-3 text-sm font-bold text-[#e0654f]">
              {client.lastError ?? "That room isn't open."}{" "}
              <button type="button" className="underline" onClick={leaveRoom}>Back to the rooms</button>
            </p>
          )}
          {overlay === "auth" && (
            <p className="mt-3 text-sm font-bold text-[#e0654f]">
              Your session couldn't be verified — sign in again to play online.
            </p>
          )}
          {(overlay === "error" || overlay === "closed") && !inRun && (
            <p className="mt-3 text-sm font-bold text-[#e0654f]">
              The connection dropped.{" "}
              <button type="button" className="underline" onClick={() => void client.connect(client.code)}>
                Reconnect
              </button>{" "}
              or{" "}
              <button type="button" className="underline" onClick={leaveRoom}>
                leave the room
              </button>
              .
            </p>
          )}
          {(overlay === "error" || overlay === "closed") && inRun && (
            <p className="mt-3 text-sm font-bold text-[#e0654f]">
              Connection lost mid-run — your seat and purse are kept for a bit.{" "}
              <button type="button" className="underline" onClick={() => void client.connect(client.code)}>
                Reconnect
              </button>
            </p>
          )}

          {!inRun && !overlay && (
            <>
              <ul className="mt-3 space-y-1.5">
                {client.players.map((p) => (
                  <li key={p.peerId} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${rowBg}`}>
                    <span className={`h-2 w-2 rounded-full ${p.connected ? "bg-[#7bc47f]" : "bg-[#e0654f]"}`} />
                    <span className={`font-bold ${ink}`}>{p.displayName}</span>
                    {p.isHost && (
                      <span className="inline-flex items-center gap-1 text-xs font-black text-[#C9A84C]">
                        <Crown className="h-3.5 w-3.5" /> HOST
                      </span>
                    )}
                    {client.self?.peerId === p.peerId && <span className={`text-xs ${muted}`}>(you)</span>}
                  </li>
                ))}
              </ul>
              {client.isHost ? (
                <button type="button" className={`${goldBtn} mt-4`} onClick={() => client.start()}>
                  <Play className="h-4 w-4" /> Start the run
                </button>
              ) : (
                <p className={`mt-4 text-sm ${muted}`}>Waiting for the host to start the run…</p>
              )}
              {client.lastError && client.status === "inside" && (
                <p className="mt-2 text-sm font-bold text-[#e0654f]">{client.lastError}</p>
              )}
            </>
          )}

          {inRun && (
            <div className="mt-3">
              <CrownfallRunGame light={light} mp={client} onGameOver={(r) => void submitMpScore(r)} />
              {scoreLine && <p className={`mt-2 text-sm font-bold ${ink}`}>{scoreLine}</p>}
              {!client.started && client.status === "inside" && (
                <div className={`mt-3 flex flex-wrap items-center gap-2 rounded-xl px-3.5 py-2.5 ${rowBg}`}>
                  <p className={`text-sm font-bold ${ink}`}>The run is over.</p>
                  {client.isHost ? (
                    <button type="button" className={goldBtn} onClick={() => client.start()}>
                      <Play className="h-4 w-4" /> Start a new run
                    </button>
                  ) : (
                    <p className={`text-sm ${muted}`}>Waiting for the host to start the next run…</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
