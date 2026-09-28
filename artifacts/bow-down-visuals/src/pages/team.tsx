import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Users, UserPlus, Coins, Trash2, LogOut, Crown, Shield, User as UserIcon } from "lucide-react";

interface Team {
  id: string;
  name: string;
  logoUrl: string | null;
  ownerId: string;
  credits: number;
  allowPersonalFallback: boolean;
  myRole: string | null;
  myStatus: string | null;
}

interface TeamMember {
  id: string;
  teamId: string;
  userId: string | null;
  email: string;
  role: string;
  status: string;
}

interface Invite {
  id: string;
  teamId: string;
  email: string;
  role: string;
  team: { id: string; name: string } | null;
}

interface SpendRow {
  userId: string;
  email: string | null;
  action: string;
  total: number;
}

export default function TeamPage() {
  usePageTitle("Team Workspace");
  const { getAccessToken } = useAuth();

  const [teams, setTeams] = useState<Team[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [activeTeam, setActiveTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [spending, setSpending] = useState<SpendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [canCreate, setCanCreate] = useState(true);

  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [fundAmount, setFundAmount] = useState("");
  const [funding, setFunding] = useState(false);
  const [transferEmail, setTransferEmail] = useState("");
  const [transferring, setTransferring] = useState(false);

  async function api(path: string, opts?: RequestInit) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token ?? ""}`,
        ...(opts?.headers ?? {}),
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function load(): Promise<boolean> {
    setLoading(true);
    setMsg(null);
    try {
      const data = await api("/api/teams");
      setTeams(data.teams ?? []);
      setInvites(data.invites ?? []);
      setCanCreate(data.canCreate !== false);
      const mine = (data.teams ?? []).find((t: Team) => t.myStatus === "active") ?? null;
      setActiveTeam(mine);
      if (mine) {
        const detail = await api(`/api/teams/${mine.id}`);
        setMembers(detail.members ?? []);
        if (detail.myRole === "owner" || detail.myRole === "admin") {
          try {
            const spend = await api(`/api/teams/${mine.id}/spending`);
            setSpending(spend.spending ?? []);
          } catch {
            setSpending([]);
          }
        }
      } else {
        setMembers([]);
        setSpending([]);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to load teams.");
      return false;
    } finally {
      setLoading(false);
    }
    return true;
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    if (!newTeamName.trim()) return;
    setCreating(true);
    setMsg(null);
    try {
      await api("/api/teams", { method: "POST", body: JSON.stringify({ name: newTeamName.trim() }) });
      setNewTeamName("");
      const loaded = await load();
      setMsg(loaded ? "✓ Team created." : "✓ Team created, but the team list failed to reload — refresh the page.");
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed to create team."}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleInvite() {
    if (!activeTeam || !inviteEmail.trim()) return;
    setInviting(true);
    setMsg(null);
    try {
      await api(`/api/teams/${activeTeam.id}/invite`, {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setInviteEmail("");
      await load();
      setMsg("✓ Invite sent.");
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed to send invite."}`);
    } finally {
      setInviting(false);
    }
  }

  async function handleAccept(teamId: string) {
    setMsg(null);
    try {
      await api(`/api/teams/${teamId}/accept`, { method: "POST" });
      await load();
      setMsg("✓ Welcome to the team.");
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed to accept invite."}`);
    }
  }

  async function handleDecline(teamId: string) {
    try {
      await api(`/api/teams/${teamId}/decline`, { method: "POST" });
      await load();
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed to decline invite."}`);
    }
  }

  async function handleRoleChange(memberId: string, role: string) {
    if (!activeTeam) return;
    try {
      await api(`/api/teams/${activeTeam.id}/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await load();
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed to change role."}`);
    }
  }

  async function handleRemove(memberId: string, email: string) {
    if (!activeTeam || !confirm(`Remove ${email} from the team?`)) return;
    try {
      await api(`/api/teams/${activeTeam.id}/members/${memberId}`, { method: "DELETE" });
      await load();
      setMsg("✓ Member removed.");
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed to remove member."}`);
    }
  }

  async function handleLeave() {
    if (!activeTeam || !confirm(`Leave ${activeTeam.name}?`)) return;
    try {
      await api(`/api/teams/${activeTeam.id}/leave`, { method: "POST" });
      await load();
      setMsg("✓ You left the team.");
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed to leave team."}`);
    }
  }

  async function handleFund() {
    if (!activeTeam) return;
    const amount = Math.floor(Number(fundAmount));
    if (!amount || amount <= 0) {
      setMsg("✗ Enter a credit amount greater than 0.");
      return;
    }
    if (!confirm(`Move ${amount} Visual Bucs from your balance to the team pool?`)) return;
    setFunding(true);
    setMsg(null);
    try {
      // Idempotency key: if the request is retried (network blip, double-click),
      // the server returns the original result instead of double-funding.
      const idempotencyKey = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const data = await api(`/api/teams/${activeTeam.id}/fund`, {
        method: "POST",
        body: JSON.stringify({ credits: amount, idempotencyKey }),
      });
      setFundAmount("");
      await load();
      setMsg(data?.duplicate ? `✓ Already funded — no duplicate charge.` : `✓ ${amount} Visual Bucs added to the team pool.`);
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed to fund the pool."}`);
    } finally {
      setFunding(false);
    }
  }

  async function handleToggleFallback() {
    if (!activeTeam) return;
    const next = !activeTeam.allowPersonalFallback;
    setMsg(null);
    try {
      const data = await api(`/api/teams/${activeTeam.id}`, {
        method: "PATCH",
        body: JSON.stringify({ allowPersonalFallback: next }),
      });
      setActiveTeam((prev) => (prev ? { ...prev, allowPersonalFallback: data.team.allowPersonalFallback } : prev));
      setMsg(next ? "✓ Personal credit fallback enabled." : "✓ Personal credit fallback disabled — pool-only spending.");
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed to update setting."}`);
    }
  }

  async function handleDelete() {
    if (!activeTeam || !confirm(`Delete ${activeTeam.name}? This cannot be undone.`)) return;
    try {
      await api(`/api/teams/${activeTeam.id}`, { method: "DELETE" });
      await load();
      setMsg("✓ Team deleted.");
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed to delete team."}`);
    }
  }

  async function handleTransfer() {
    if (!activeTeam || !transferEmail) return;
    if (!confirm(`Transfer ownership of ${activeTeam.name} to ${transferEmail}? You will become an admin.`)) return;
    setTransferring(true);
    setMsg(null);
    try {
      await api(`/api/teams/${activeTeam.id}/transfer`, {
        method: "POST",
        body: JSON.stringify({ email: transferEmail }),
      });
      setTransferEmail("");
      await load();
      setMsg("✓ Ownership transferred.");
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : "Failed to transfer ownership."}`);
    } finally {
      setTransferring(false);
    }
  }

  const roleIcon = (role: string) =>
    role === "owner" ? <Crown className="h-3.5 w-3.5 text-[#C9A84C]" /> :
    role === "admin" ? <Shield className="h-3.5 w-3.5 text-blue-400" /> :
    <UserIcon className="h-3.5 w-3.5 text-white/40" />;

  if (loading) {
    return (
      <div className="p-8 text-center text-white/50">
        <Users className="h-8 w-8 mx-auto mb-3 animate-pulse text-[#C9A84C]" />
        Loading your team…
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-7 w-7 text-[#C9A84C]" />
        <div>
          <h1 className="text-2xl font-black text-white">Team Workspace</h1>
          <p className="text-sm text-white/50">Shared credit pool, shared vaults, one crew.</p>
        </div>
      </div>

      {msg && (
        <p className={`text-sm rounded-lg px-4 py-2 ${msg.startsWith("✓") ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"}`}>
          {msg}
        </p>
      )}

      {/* Pending invites */}
      {invites.length > 0 && (
        <Card className="p-5 bg-white/[0.03] border-white/10">
          <h2 className="font-bold text-white mb-3 flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-[#C9A84C]" /> Pending invites
          </h2>
          <div className="space-y-2">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-4 py-3">
                <div>
                  <p className="text-white font-semibold">{inv.team?.name ?? "Team"}</p>
                  <p className="text-xs text-white/40">Invited as {inv.role}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void handleAccept(inv.teamId)} className="bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 font-bold">
                    Accept
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void handleDecline(inv.teamId)} className="text-white/50">
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!activeTeam ? (
        <Card className="p-6 bg-white/[0.03] border-white/10">
          <h2 className="font-bold text-white mb-2">Create a team</h2>
          <p className="text-sm text-white/50 mb-4">
            Included with Shot Caller ($199/mo). Pool your Visual Bucs, share artist vaults, and create together.
          </p>
          {canCreate ? (
            <div className="flex gap-2">
              <Input
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="Team name — e.g. Blockdollaz Media"
                maxLength={80}
                className="bg-white/[0.05] border-white/10 text-white"
              />
              <Button onClick={() => void handleCreate()} disabled={creating || !newTeamName.trim()} className="bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 font-bold shrink-0">
                {creating ? "Creating…" : "Create team"}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-[#C9A84C]/40 bg-[#C9A84C]/10 px-4 py-3">
              <p className="text-sm text-[#C9A84C] font-semibold flex items-center gap-2">
                <Crown className="h-4 w-4" /> Shot Caller tier required
              </p>
              <p className="text-xs text-white/50 mt-1">
                Upgrade to Shot Caller ($199/mo) to create your own team. You can still join teams you're invited to.
              </p>
            </div>
          )}
        </Card>
      ) : (
        <>
          {/* Pool balance */}
          <Card className="p-6 bg-gradient-to-br from-[#C9A84C]/15 to-transparent border-[#C9A84C]/30">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-white/40 font-semibold">Team pool</p>
                <p className="text-4xl font-black text-[#C9A84C] flex items-center gap-2">
                  <Coins className="h-7 w-7" /> {activeTeam.credits.toLocaleString()}
                </p>
                <p className="text-xs text-white/40 mt-1">Visual Bucs shared across all members</p>
              </div>
              {(activeTeam.myRole === "owner" || activeTeam.myRole === "admin") && (
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    min={1}
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    placeholder="Credits"
                    className="w-28 bg-white/[0.05] border-white/10 text-white"
                  />
                  <Button onClick={() => void handleFund()} disabled={funding} className="bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 font-bold">
                    {funding ? "Moving…" : "Fund pool"}
                  </Button>
                </div>
              )}
            </div>
            {(activeTeam.myRole === "owner" || activeTeam.myRole === "admin") && (
              <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-white">Personal credit fallback</p>
                  <p className="text-xs text-white/40">
                    {activeTeam.allowPersonalFallback
                      ? "When the pool runs low, member spending uses personal Visual Bucs."
                      : "Pool-only: spending stops when the pool is empty. Personal Visual Bucs are never touched."}
                  </p>
                </div>
                <Button
                  onClick={() => void handleToggleFallback()}
                  variant="outline"
                  className={activeTeam.allowPersonalFallback ? "border-[#C9A84C]/50 text-[#C9A84C]" : "border-white/10 text-white/60"}
                >
                  {activeTeam.allowPersonalFallback ? "Fallback ON" : "Fallback OFF"}
                </Button>
              </div>
            )}
          </Card>

          {/* Invite */}
          {(activeTeam.myRole === "owner" || activeTeam.myRole === "admin") && (
            <Card className="p-5 bg-white/[0.03] border-white/10">
              <h2 className="font-bold text-white mb-3 flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-[#C9A84C]" /> Invite a member
              </h2>
              <div className="flex gap-2 flex-wrap">
                <Input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@email.com"
                  type="email"
                  className="flex-1 min-w-[200px] bg-white/[0.05] border-white/10 text-white"
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="rounded-lg bg-white/[0.05] border border-white/10 text-white px-3 py-2 text-sm"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <Button onClick={() => void handleInvite()} disabled={inviting || !inviteEmail.trim()} className="bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 font-bold">
                  {inviting ? "Sending…" : "Send invite"}
                </Button>
              </div>
            </Card>
          )}

          {/* Members */}
          <Card className="p-5 bg-white/[0.03] border-white/10">
            <h2 className="font-bold text-white mb-3">
              Members <span className="text-white/40 font-normal">({members.length})</span>
            </h2>
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-4 py-3">
                  <div className="flex items-center gap-3">
                    {roleIcon(m.role)}
                    <div>
                      <p className="text-white text-sm font-semibold">{m.email}</p>
                      <p className="text-xs text-white/40 capitalize">
                        {m.role}{m.status === "invited" ? " · invite pending" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {activeTeam.myRole === "owner" && m.role !== "owner" && m.status === "active" && (
                      <select
                        value={m.role}
                        onChange={(e) => void handleRoleChange(m.id, e.target.value)}
                        className="rounded-lg bg-white/[0.05] border border-white/10 text-white px-2 py-1 text-xs"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                    {(activeTeam.myRole === "owner" || (activeTeam.myRole === "admin" && m.role === "member")) &&
                      m.role !== "owner" && (
                        <Button size="sm" variant="ghost" onClick={() => void handleRemove(m.id, m.email)} className="text-red-400/70 hover:text-red-300">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Spending */}
          {spending.length > 0 && (
            <Card className="p-5 bg-white/[0.03] border-white/10">
              <h2 className="font-bold text-white mb-3">Pool spending</h2>
              <div className="space-y-1.5">
                {spending.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-sm rounded bg-white/[0.03] px-3 py-2">
                    <span className="text-white/70">{s.email ?? s.userId.slice(0, 8)} · <span className="text-white/40">{s.action}</span></span>
                    <span className="text-[#C9A84C] font-bold">{s.total.toLocaleString()} cr</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Danger zone */}
          <Card className="p-5 bg-white/[0.03] border-white/10">
            {activeTeam.myRole === "owner" && (
              <div className="mb-4 pb-4 border-b border-white/10">
                <p className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                  <Crown className="h-4 w-4 text-[#C9A84C]" /> Transfer ownership
                </p>
                <div className="flex gap-2">
                  <select
                    value={transferEmail}
                    onChange={(e) => setTransferEmail(e.target.value)}
                    className="flex-1 bg-white/[0.05] border border-white/10 rounded-md px-3 py-2 text-sm text-white"
                  >
                    <option value="">Choose a member…</option>
                    {members
                      .filter((m) => m.status === "active" && m.role !== "owner" && m.userId)
                      .map((m) => (
                        <option key={m.id} value={m.email}>{m.email} ({m.role})</option>
                      ))}
                  </select>
                  <Button
                    onClick={() => void handleTransfer()}
                    disabled={transferring || !transferEmail}
                    className="bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 font-bold shrink-0"
                  >
                    {transferring ? "Transferring…" : "Transfer"}
                  </Button>
                </div>
              </div>
            )}
            <div className="flex gap-3 flex-wrap">
              {activeTeam.myRole !== "owner" ? (
                <Button variant="ghost" onClick={() => void handleLeave()} className="text-white/60">
                  <LogOut className="h-4 w-4 mr-2" /> Leave team
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => void handleDelete()} className="text-red-400/80 hover:text-red-300">
                  <Trash2 className="h-4 w-4 mr-2" /> Delete team
                </Button>
              )}
            </div>
            <p className="text-xs text-white/30 mt-3">
              Shared vaults: mark any artist vault as shared from the Creator Vault page and the whole team can use it.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
