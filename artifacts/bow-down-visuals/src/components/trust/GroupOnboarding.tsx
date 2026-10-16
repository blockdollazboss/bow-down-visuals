import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

/* #7 Group onboarding + roles: join questions set by admins, requests
   reviewed with the answers in view, and the role ladder
   (owner > admin > moderator > member) enforced by the API — this
   panel only shows the controls your rung actually has. */
export function GroupOnboarding({ slug, members }: { slug: string; members: Array<{ user_id: string; role: string }> }) {
  const { getAccessToken, user } = useAuth();
  const [myRole, setMyRole] = useState<string | null>(null);
  const [can, setCan] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [draft, setDraft] = useState("");
  const [requests, setRequests] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const call = useCallback(async (method: string, path: string, body?: unknown) => {
    const t = await getAccessToken();
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as any)?.error ?? "Something went wrong.");
    return j as any;
  }, [getAccessToken]);

  const load = useCallback(async () => {
    try {
      const q = await call("GET", `/api/groups/${slug}/join-questions`);
      setQuestions(q.questions ?? []);
      if (user) {
        const r = await call("GET", `/api/groups/${slug}/my-role`);
        setMyRole(r.role); setCan(r.can);
        if (r.can?.reviewJoinRequests) {
          const queue = await call("GET", `/api/groups/${slug}/join-requests`);
          setRequests(queue.requests ?? []);
        }
      }
    } catch { /* the group page itself already surfaces load errors */ }
  }, [call, slug, user]);
  useEffect(() => { void load(); }, [load]);

  const card = "rounded-2xl border border-white/10 bg-white/[0.03] p-5";
  const input = "w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white";
  const ghost = "rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50";

  return (
    <section className={card}>
      <h3 className="text-base font-black text-white">Joining &amp; roles</h3>
      <p className="mt-1 text-sm text-white/60">
        Roles run owner → admin → moderator → member, and the ladder is enforced: moderators review join
        requests, admins set the questions and roles, ownership never moves through a role edit.
        {myRole ? <> Your role here: <strong className="text-white">{myRole}</strong>.</> : null}
      </p>
      {msg && <p className="mt-2 text-sm text-emerald-400">{msg}</p>}

      {!myRole && user && questions.length > 0 && (
        <div className="mt-4 grid gap-3">
          <p className="text-sm text-white/80">This group asks a few questions before you join — the admins read your answers when they decide.</p>
          {questions.map((q) => (
            <label key={q.id} className="grid gap-1 text-sm text-white/80">{q.question}
              <input className={input} value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
            </label>
          ))}
          <button type="button" className={ghost} onClick={async () => {
            try { await call("POST", `/api/groups/${slug}/join-requests`, { answers: questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? "" })) }); setMsg("Request sent — the admins have your answers."); }
            catch (e) { setMsg(e instanceof Error ? e.message : "Could not send your request."); }
          }}>Request to join</button>
        </div>
      )}
      {!myRole && user && questions.length === 0 && <p className="mt-3 text-sm text-white/60">This group takes direct joins — use the Join button above.</p>}

      {can?.setJoinQuestions && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="text-sm font-bold text-white">Join questions (admins &amp; owner)</p>
          <p className="text-xs text-white/50">One question per line, up to five. Saving replaces the current set.</p>
          <textarea className={input + " mt-2"} rows={3} defaultValue={questions.map((q) => q.question).join("\n")} onChange={(e) => setDraft(e.target.value)} placeholder={"Why do you want in?\nWhat do you make?"} />
          <button type="button" className={ghost + " mt-2"} onClick={async () => {
            try { const qs = (draft || questions.map((q) => q.question).join("\n")).split("\n").map((x) => x.trim()).filter(Boolean); await call("PUT", `/api/groups/${slug}/join-questions`, { questions: qs }); setMsg("Join questions saved."); void load(); }
            catch (e) { setMsg(e instanceof Error ? e.message : "Could not save questions."); }
          }}>Save questions</button>
        </div>
      )}

      {can?.reviewJoinRequests && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="text-sm font-bold text-white">Join requests ({requests.length})</p>
          {requests.length === 0 && <p className="mt-1 text-sm text-white/60">Nobody is waiting right now.</p>}
          {requests.map((r) => (
            <div key={r.id} className="mt-2 rounded-xl border border-white/10 p-3 text-sm text-white/80">
              {(r.answers ?? []).map((a: any, i: number) => <p key={i}><strong className="text-white">{a.question}</strong> — {a.answer}</p>)}
              <div className="mt-2 flex gap-2">
                <button type="button" className={ghost} onClick={async () => { await call("POST", `/api/groups/${slug}/join-requests/${r.id}/review`, { decision: "approve" }); setMsg("Approved — they're in."); void load(); }}>Approve</button>
                <button type="button" className={ghost} onClick={async () => { await call("POST", `/api/groups/${slug}/join-requests/${r.id}/review`, { decision: "deny" }); setMsg("Request denied."); void load(); }}>Deny</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {can?.setMemberRole && members.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="text-sm font-bold text-white">Member roles</p>
          {members.filter((m) => m.user_id !== user?.id).map((m) => (
            <div key={m.user_id} className="mt-1.5 flex items-center gap-2 text-sm text-white/80">
              <span className="flex-1">{m.user_id.slice(0, 8)}… — {m.role === "mod" ? "moderator" : m.role}</span>
              {(["admin", "moderator", "member"] as const).filter((r) => r !== m.role && !(m.role === "mod" && r === "moderator")).map((r) => (
                <button key={r} type="button" className={ghost} onClick={async () => {
                  try { await call("PATCH", `/api/groups/${slug}/members/${m.user_id}/role`, { role: r }); setMsg(`Role set to ${r}. Reload the page to see it everywhere.`); }
                  catch (e) { setMsg(e instanceof Error ? e.message : "Your rung can't make that change."); }
                }}>Make {r}</button>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
