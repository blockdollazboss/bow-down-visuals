import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

/* #6 Stage audio rooms. Presence is the socket's truth: the peer list
   is whatever the room says it is. Voice is a small WebRTC mesh
   (speaker cap 8, room cap 25) using STUN only — no relay server, so
   a strict network can still block a voice connection; that's stated
   here, not hidden. Guests listen only. */

interface Peer { peerId: string; displayName: string; role: string; guest: boolean; voice: boolean }

export function StageRooms() {
  const { getAccessToken, user } = useAuth();
  const [rooms, setRooms] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<any>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [me, setMe] = useState<Peer | null>(null);
  const [chat, setChat] = useState<Array<{ from: string; body: string }>>([]);
  const [say, setSay] = useState("");
  const [denied, setDenied] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const streamRef = useRef<MediaStream | null>(null);
  const myIdRef = useRef<string>("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/stage-rooms");
      const j = await res.json();
      setRooms(j.rooms ?? []);
    } catch { setErr("Could not load rooms."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    try {
      const t = await getAccessToken();
      const res = await fetch("/api/stage-rooms", { method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ title: title.trim() }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Could not open the room.");
      setTitle(""); void load(); join(j.room);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not open the room."); }
  }

  function peerPc(peerId: string, stream: MediaStream | null): RTCPeerConnection {
    let pc = pcsRef.current.get(peerId);
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    if (stream) stream.getTracks().forEach((tr) => pc!.addTrack(tr, stream));
    pc.ontrack = (ev) => {
      const audio = new Audio();
      audio.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
      void audio.play().catch(() => { /* autoplay policies — user gesture already happened on join */ });
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) wsRef.current?.send(JSON.stringify({ type: "voice.signal", to: peerId, data: { ice: ev.candidate.toJSON() } }));
    };
    pcsRef.current.set(peerId, pc);
    return pc;
  }

  async function join(room: any) {
    leave();
    setActive(room); setPeers([]); setChat([]); setDenied(null);
    const t = await getAccessToken().catch(() => null);
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/api/stage-rooms/${room.id}/ws${t ? `?token=${encodeURIComponent(t)}` : ""}`);
    wsRef.current = ws;
    ws.onmessage = async (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.type === "welcome") { myIdRef.current = m.peerId; setMe(m.you); setPeers(m.peers ?? []); }
      else if (m.type === "peer.join") setPeers((p) => [...p.filter((x) => x.peerId !== m.peer.peerId), m.peer]);
      else if (m.type === "peer.leave") setPeers((p) => p.filter((x) => x.peerId !== m.peerId));
      else if (m.type === "peer.role") setPeers((p) => p.map((x) => (x.peerId === m.peerId ? { ...x, role: m.role, voice: m.voice } : x)));
      else if (m.type === "peer.say") setChat((c) => [...c.slice(-49), { from: m.displayName, body: m.body }]);
      else if (m.type === "denied" || m.type === "voice.denied") setDenied(m.reason);
      else if (m.type === "room_full") setErr(`That room is full — ${m.cap} people is the room limit.`);
      else if (m.type === "voice.signal" && m.from) {
        const pc = peerPc(m.from, streamRef.current);
        const d = m.data ?? {};
        if (d.sdp) {
          await pc.setRemoteDescription(d.sdp).catch(() => {});
          if (d.sdp.type === "offer") {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: "voice.signal", to: m.from, data: { sdp: answer } }));
          }
        } else if (d.ice) await pc.addIceCandidate(d.ice).catch(() => {});
      }
    };
  }

  async function joinVoice() {
    setDenied(null);
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch { setDenied("Microphone access was denied — check your browser's mic permission for this site."); return; }
    wsRef.current?.send(JSON.stringify({ type: "voice.join" }));
    // Offer to everyone already in the mesh on the next tick; answers flow back through voice.signal.
    setTimeout(() => {
      peers.filter((p) => p.voice).forEach(async (p) => {
        const pc = peerPc(p.peerId, streamRef.current);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        wsRef.current?.send(JSON.stringify({ type: "voice.signal", to: p.peerId, data: { sdp: offer } }));
      });
    }, 300);
  }

  function leave() {
    wsRef.current?.close();
    wsRef.current = null;
    pcsRef.current.forEach((pc) => pc.close());
    pcsRef.current.clear();
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setActive(null); setPeers([]); setMe(null);
  }
  useEffect(() => () => leave(), []);

  const card = "rounded-2xl border border-border bg-card p-6";
  const btn = "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50";
  const ghost = "rounded-lg border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50";
  const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
  const iAmHost = me?.role === "host";

  return (
    <section className={card}>
      <h2 className="text-lg font-black tracking-tight">Stage — live audio rooms</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Open a room, talk live, bring listeners up to speak. Rooms hold 25 people with up to 8 speakers at once —
        voice runs peer-to-peer (STUN only, no relay), so a strict network can still block a voice connection.
        Guests can listen; speaking and chatting need a sign-in and a promotion from the host.
      </p>
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      {!active && (
        <>
          {user && (
            <div className="mt-4 flex gap-2">
              <input className={input} placeholder="Room title — e.g. New song listening party" value={title} onChange={(e) => setTitle(e.target.value)} />
              <button type="button" className={btn} onClick={create} disabled={!title.trim()}>Open room</button>
            </div>
          )}
          <div className="mt-4 grid gap-2">
            {rooms.length === 0 && <p className="text-sm text-muted-foreground">No rooms are open right now.</p>}
            {rooms.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm">
                <span><strong>{r.title}</strong> · {(r.livePeers ?? []).length} in the room</span>
                <button type="button" className={ghost} onClick={() => join(r)}>Join</button>
              </div>
            ))}
          </div>
        </>
      )}
      {active && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">{active.title}</h3>
            <button type="button" className={ghost} onClick={leave}>Leave room</button>
          </div>
          {denied && <p className="mt-2 text-sm text-amber-500">{denied}</p>}
          <ul className="mt-3 grid gap-1 text-sm">
            {me && <li>You — {me.role}{me.guest ? " (guest, listen only)" : ""}</li>}
            {peers.map((p) => (
              <li key={p.peerId} className="flex items-center gap-2">
                <span>{p.displayName} — {p.role}{p.voice ? " · on mic" : ""}{p.guest ? " · guest" : ""}</span>
                {iAmHost && p.role === "listener" && <button type="button" className={ghost} onClick={() => wsRef.current?.send(JSON.stringify({ type: "role.set", peerId: p.peerId, role: "speaker" }))}>Bring to stage</button>}
                {iAmHost && p.role === "speaker" && <button type="button" className={ghost} onClick={() => wsRef.current?.send(JSON.stringify({ type: "role.set", peerId: p.peerId, role: "listener" }))}>Back to audience</button>}
              </li>
            ))}
          </ul>
          {me && me.role !== "listener" && !me.guest && <button type="button" className={`${btn} mt-3`} onClick={joinVoice}>Join voice</button>}
          {me?.guest && <p className="mt-2 text-xs text-muted-foreground">You&apos;re listening as a guest — sign in and ask the host to bring you to the stage to speak.</p>}
          <div className="mt-4 max-h-40 overflow-y-auto rounded-xl border border-border p-3 text-sm">
            {chat.map((c, i) => <p key={i}><strong>{c.from}:</strong> {c.body}</p>)}
            {chat.length === 0 && <p className="text-muted-foreground">Room chat — say something.</p>}
          </div>
          {user && (
            <div className="mt-2 flex gap-2">
              <input className={input} value={say} onChange={(e) => setSay(e.target.value)} placeholder="Message the room" />
              <button type="button" className={ghost} onClick={() => { if (say.trim()) { wsRef.current?.send(JSON.stringify({ type: "say", body: say.trim() })); setSay(""); } }}>Send</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
