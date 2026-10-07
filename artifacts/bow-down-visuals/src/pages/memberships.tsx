import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  Crown, Plus, Trash2, Pencil, Users, DollarSign, TrendingDown,
  Sparkles, Loader2, Check, X, AlertTriangle, BadgePercent,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Fan Memberships ───────────────────────────────────────────────────
   /memberships — creators launch fan clubs with paid tiers. Tier setup +
   member tracking are free. The site takes a 10% platform fee once payment
   processing ships (honest "coming soon" — never faked). The AI perk
   suggester costs 1 credit per suggestion (charge-before-generate). */

interface Tier {
  id: string;
  name: string;
  priceDollars: number;
  priceCents: number;
  description: string;
  perks: string[];
  isActive: boolean;
  createdAt: string;
}

interface TierBreakdown {
  tierId: string;
  name: string;
  activeMembers: number;
  mrrCents: number;
}

interface Dashboard {
  activeMembers: number;
  pastDueMembers: number;
  canceledMembers: number;
  mrrCents: number;
  mrrDollars: number;
  netMrrCents: number;
  churnPct: number;
  byTier: TierBreakdown[];
  paymentsLive: boolean;
}

interface Member {
  id: string;
  tierId: string;
  tierName: string;
  fanLabel: string;
  status: "active" | "past_due" | "canceled";
  priceDollars: number;
  joinedAt: string;
}

interface SuggestedTier {
  name: string;
  priceDollars: number;
  perks: string[];
}

const GOLD_BTN =
  "inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-6 py-3 text-base font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50";
const CARD =
  "rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6";
const INPUT =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-primary/60 focus:outline-none";

async function api(path: string, token: string | null, init?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, data };
}

export default function Memberships() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Tier form state */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("5");
  const [description, setDescription] = useState("");
  const [perkInput, setPerkInput] = useState("");
  const [perks, setPerks] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  /* Member form state */
  const [memberTier, setMemberTier] = useState("");
  const [fanLabel, setFanLabel] = useState("");
  const [addingMember, setAddingMember] = useState(false);

  /* AI suggester state */
  const [niche, setNiche] = useState("");
  const [audienceSize, setAudienceSize] = useState<"starting" | "growing" | "established">("growing");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedTier[]>([]);
  const [outOfCredits, setOutOfCredits] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const [{ data: t }, { data: d }, { data: m }] = await Promise.all([
        api("/memberships/tiers", token),
        api("/memberships/dashboard", token),
        api("/memberships/members", token),
      ]);
      if (Array.isArray(t.tiers)) setTiers(t.tiers as Tier[]);
      if (d.activeMembers !== undefined) setDashboard(d as unknown as Dashboard);
      if (Array.isArray(m.members)) setMembers(m.members as Member[]);
    } catch {
      setError(t("memberships.errorLoad"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user) void load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setPrice("5");
    setDescription("");
    setPerks([]);
    setPerkInput("");
  }

  function startEdit(t: Tier) {
    setEditingId(t.id);
    setName(t.name);
    setPrice(String(t.priceDollars));
    setDescription(t.description);
    setPerks(t.perks);
    setPerkInput("");
  }

  async function saveTier() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const token = await getAccessToken();
      const body = {
        name: name.trim(),
        priceDollars: Math.max(0, Math.min(999.99, parseFloat(price) || 0)),
        description: description.trim(),
        perks,
      };
      const { res } = editingId
        ? await api(`/memberships/tiers/${editingId}`, token, { method: "PUT", body: JSON.stringify(body) })
        : await api("/memberships/tiers", token, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
      resetForm();
      await load();
    } catch {
      setError(t("memberships.errorSaveTier"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteTier(id: string) {
    if (!confirm(t("memberships.confirmDeleteTier"))) return;
    try {
      const token = await getAccessToken();
      await api(`/memberships/tiers/${id}`, token, { method: "DELETE" });
      await load();
    } catch {
      setError(t("memberships.errorDeleteTier"));
    }
  }

  async function addMember() {
    if (!memberTier || !fanLabel.trim()) return;
    setAddingMember(true);
    try {
      const token = await getAccessToken();
      const { res, data } = await api("/memberships/members", token, {
        method: "POST",
        body: JSON.stringify({ tierId: memberTier, fanLabel: fanLabel.trim() }),
      });
      if (res.status === 409) {
        setError(String(data.error ?? t("memberships.errorDuplicateMember")));
        return;
      }
      if (!res.ok) throw new Error();
      setFanLabel("");
      await load();
    } catch {
      setError(t("memberships.errorAddMember"));
    } finally {
      setAddingMember(false);
    }
  }

  async function setMemberStatus(id: string, status: Member["status"]) {
    try {
      const token = await getAccessToken();
      await api(`/memberships/members/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch {
      setError(t("memberships.errorUpdateMember"));
    }
  }

  async function removeMember(id: string) {
    if (!confirm(t("memberships.confirmRemoveMember"))) return;
    try {
      const token = await getAccessToken();
      await api(`/memberships/members/${id}`, token, { method: "DELETE" });
      await load();
    } catch {
      setError(t("memberships.errorRemoveMember"));
    }
  }

  async function suggestTiers() {
    if (!niche.trim() || suggesting) return;
    setSuggesting(true);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const { res, data } = await api("/memberships/ai-perks", token, {
        method: "POST",
        body: JSON.stringify({ niche: niche.trim(), audienceSize, tierCount: 3 }),
      });
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.tiers)) throw new Error();
      setSuggestions(data.tiers as SuggestedTier[]);
      refreshProfile();
    } catch {
      setError(t("memberships.errorSuggester"));
    } finally {
      setSuggesting(false);
    }
  }

  function applySuggestion(s: SuggestedTier) {
    setEditingId(null);
    setName(s.name);
    setPrice(String(s.priceDollars));
    setDescription("");
    setPerks(s.perks);
    setPerkInput("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const fmt$ = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 === 0 ? 0 : 2 });

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="max-w-6xl mx-auto px-5 md:px-8 py-10">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-primary mb-4">
            <Crown className="h-3.5 w-3.5" /> {t("memberships.badge")}
          </div>
          <h1 className="text-4xl md:text-5xl font-black">
            {t("memberships.titleStart")} <span className="text-primary">{t("memberships.titleAccent")}</span>
          </h1>
          <p className="mt-3 text-white/60 max-w-2xl mx-auto">
            {t("memberships.subtitle")}
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t("memberships.paymentsNotice")}
          </div>
        </div>

        {!user ? (
          <div className={CARD + " text-center"}>
            <p className="text-white/70 mb-4">{t("memberships.signInPrompt")}</p>
            <Link href="/login" className={GOLD_BTN}>{t("memberships.signIn")}</Link>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-10">
            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center justify-between">
                {error}
                <button onClick={() => setError(null)} aria-label={t("memberships.dismiss")}><X className="h-4 w-4" /></button>
              </div>
            )}

            {/* ── Dashboard ── */}
            {dashboard && (
              <section>
                <h2 className="text-2xl font-black mb-4 flex items-center gap-2">
                  <Users className="h-6 w-6 text-primary" /> {t("memberships.dashboardTitle")}
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className={CARD}>
                    <div className="text-xs uppercase tracking-widest text-white/40 mb-1">{t("memberships.activeMembers")}</div>
                    <div className="text-3xl font-black text-primary">{dashboard.activeMembers}</div>
                  </div>
                  <div className={CARD}>
                    <div className="text-xs uppercase tracking-widest text-white/40 mb-1">{t("memberships.monthlyRevenue")}</div>
                    <div className="text-3xl font-black">{fmt$(dashboard.mrrDollars)}</div>
                    <div className="text-xs text-white/40 mt-1 flex items-center gap-1">
                      <BadgePercent className="h-3 w-3" />
                      {t("memberships.afterFee", { amount: fmt$(dashboard.netMrrCents / 100) })}
                    </div>
                  </div>
                  <div className={CARD}>
                    <div className="text-xs uppercase tracking-widest text-white/40 mb-1">{t("memberships.churn")}</div>
                    <div className="text-3xl font-black flex items-center gap-2">
                      <TrendingDown className="h-6 w-6 text-amber-400" />{dashboard.churnPct}%
                    </div>
                  </div>
                  <div className={CARD}>
                    <div className="text-xs uppercase tracking-widest text-white/40 mb-1">{t("memberships.pastDue")}</div>
                    <div className="text-3xl font-black text-amber-400">{dashboard.pastDueMembers}</div>
                  </div>
                </div>
                {dashboard.byTier.length > 0 && (
                  <div className="mt-4 grid md:grid-cols-3 gap-4">
                    {dashboard.byTier.map((b) => (
                      <div key={b.tierId} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                        <div className="font-bold">{b.name}</div>
                        <div className="text-sm text-white/50 mt-1">
                          {t("memberships.tierStats", { count: b.activeMembers, amount: fmt$(b.mrrCents / 100) })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ── Tier builder ── */}
            <section>
              <h2 className="text-2xl font-black mb-4 flex items-center gap-2">
                <Crown className="h-6 w-6 text-primary" /> {editingId ? t("memberships.editTier") : t("memberships.buildTier")}
              </h2>
              <div className={CARD + " space-y-4"}>
                <div className="grid md:grid-cols-2 gap-4">
                  <input className={INPUT} placeholder={t("memberships.tierNamePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                    <input className={INPUT + " pl-9"} placeholder={t("memberships.pricePlaceholder")} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
                  </div>
                </div>
                <textarea className={INPUT} placeholder={t("memberships.descriptionPlaceholder")} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} />
                <div>
                  <div className="flex gap-2">
                    <input
                      className={INPUT}
                      placeholder={t("memberships.perkPlaceholder")}
                      value={perkInput}
                      onChange={(e) => setPerkInput(e.target.value)}
                      maxLength={140}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && perkInput.trim() && perks.length < 20) {
                          e.preventDefault();
                          setPerks([...perks, perkInput.trim()]);
                          setPerkInput("");
                        }
                      }}
                    />
                    <button
                      className="shrink-0 rounded-xl border border-primary/40 px-4 text-sm font-bold text-primary hover:bg-primary/10"
                      onClick={() => {
                        if (perkInput.trim() && perks.length < 20) {
                          setPerks([...perks, perkInput.trim()]);
                          setPerkInput("");
                        }
                      }}
                    >
                      Add
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {perks.map((p, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs">
                        <Check className="h-3 w-3 text-primary" />{p}
                        <button onClick={() => setPerks(perks.filter((_, j) => j !== i))} aria-label={t("memberships.removePerk")}>
                          <X className="h-3 w-3 text-white/40 hover:text-white" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3">
                  <button className={GOLD_BTN} disabled={saving || !name.trim()} onClick={saveTier}>
                    {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                    {editingId ? t("memberships.saveTier") : t("memberships.createTier")}
                  </button>
                  {editingId && (
                    <button className="rounded-2xl border border-white/15 px-6 py-3 text-sm font-bold text-white/70 hover:bg-white/5" onClick={resetForm}>
                      {t("memberships.cancel")}
                    </button>
                  )}
                </div>
              </div>

              {tiers.length > 0 && (
                <div className="mt-4 grid md:grid-cols-3 gap-4">
                  {tiers.map((tier) => (
                    <div key={tier.id} className="rounded-2xl border border-primary/20 bg-gradient-to-b from-[#171208] to-black p-5">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-black text-lg">{tier.name}</div>
                          <div className="text-primary font-bold">{fmt$(tier.priceDollars)}<span className="text-white/40 text-sm font-normal">{t("memberships.perMonth")}</span></div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => startEdit(tier)} aria-label={t("memberships.editTierAria")} className="p-1.5 rounded-lg hover:bg-white/10">
                            <Pencil className="h-4 w-4 text-white/50" />
                          </button>
                          <button onClick={() => deleteTier(tier.id)} aria-label={t("memberships.deleteTierAria")} className="p-1.5 rounded-lg hover:bg-white/10">
                            <Trash2 className="h-4 w-4 text-red-400/70" />
                          </button>
                        </div>
                      </div>
                      {tier.description && <p className="text-sm text-white/50 mt-2">{tier.description}</p>}
                      <ul className="mt-3 space-y-1.5">
                        {tier.perks.map((p, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                            <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />{p}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── AI perk suggester ── */}
            <section>
              <h2 className="text-2xl font-black mb-4 flex items-center gap-2">
                <Sparkles className="h-6 w-6 text-primary" /> {t("memberships.aiSuggesterTitle")}
                <span className="text-xs font-bold rounded-full bg-primary/15 border border-primary/30 text-primary px-2.5 py-1">{t("memberships.aiCost")}</span>
              </h2>
              <div className={CARD + " space-y-4"}>
                <p className="text-sm text-white/60">
                  {t("memberships.aiDescription")}
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  <input className={INPUT} placeholder={t("memberships.nichePlaceholder")} value={niche} onChange={(e) => setNiche(e.target.value)} maxLength={80} />
                  <div className="flex gap-2">
                    {(["starting", "growing", "established"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setAudienceSize(s)}
                        className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold capitalize transition ${
                          audienceSize === s
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-white/10 text-white/50 hover:border-white/25"
                        }`}
                      >
                        {t("memberships.audience" + s.charAt(0).toUpperCase() + s.slice(1))}
                      </button>
                    ))}
                  </div>
                </div>
                <button className={GOLD_BTN} disabled={suggesting || !niche.trim()} onClick={suggestTiers}>
                  {suggesting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                  {t("memberships.suggestButton")}
                </button>
                {outOfCredits && <OutOfCredits />}
                {suggestions.length > 0 && (
                  <div className="grid md:grid-cols-3 gap-4 pt-2">
                    {suggestions.map((s, i) => (
                      <div key={i} className="rounded-2xl border border-primary/20 bg-black/40 p-5">
                        <div className="font-black">{s.name}</div>
                        <div className="text-primary font-bold">{fmt$(s.priceDollars)}<span className="text-white/40 text-sm font-normal">/mo</span></div>
                        <ul className="mt-2 space-y-1">
                          {s.perks.map((p, j) => (
                            <li key={j} className="text-xs text-white/60 flex gap-1.5">
                              <Check className="h-3.5 w-3.5 text-primary shrink-0" />{p}
                            </li>
                          ))}
                        </ul>
                        <button
                          onClick={() => applySuggestion(s)}
                          className="mt-3 w-full rounded-xl border border-primary/40 py-2 text-sm font-bold text-primary hover:bg-primary/10"
                        >
                          {t("memberships.useTier")}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* ── Members ── */}
            <section>
              <h2 className="text-2xl font-black mb-4 flex items-center gap-2">
                <Users className="h-6 w-6 text-primary" /> {t("memberships.membersTitle")}
              </h2>
              <div className={CARD + " space-y-4"}>
                <p className="text-xs text-white/40">
                  {t("memberships.membersNote")}
                </p>
                <div className="flex flex-col md:flex-row gap-3">
                  <select
                    className={INPUT + " md:w-56"}
                    value={memberTier}
                    onChange={(e) => setMemberTier(e.target.value)}
                  >
                    <option value="">{t("memberships.pickTier")}</option>
                    {tiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>{t("memberships.tierOption", { name: tier.name, price: fmt$(tier.priceDollars) })}</option>
                    ))}
                  </select>
                  <input
                    className={INPUT}
                    placeholder={t("memberships.fanPlaceholder")}
                    value={fanLabel}
                    onChange={(e) => setFanLabel(e.target.value)}
                    maxLength={120}
                  />
                  <button
                    className="shrink-0 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black hover:brightness-110 disabled:opacity-50"
                    disabled={addingMember || !memberTier || !fanLabel.trim()}
                    onClick={addMember}
                  >
                    {addingMember ? <Loader2 className="h-4 w-4 animate-spin" /> : t("memberships.addMember")}
                  </button>
                </div>
                {members.length > 0 ? (
                  <div className="divide-y divide-white/5">
                    {members.map((m) => (
                      <div key={m.id} className="py-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-sm">{m.fanLabel}</div>
                          <div className="text-xs text-white/40">
                            {t("memberships.memberMeta", { tier: m.tierName, price: fmt$(m.priceDollars), date: new Date(m.joinedAt).toLocaleDateString() })}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            className="rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-xs text-white"
                            value={m.status}
                            onChange={(e) => setMemberStatus(m.id, e.target.value as Member["status"])}
                          >
                            <option value="active">{t("memberships.statusActive")}</option>
                            <option value="past_due">{t("memberships.statusPastDue")}</option>
                            <option value="canceled">{t("memberships.statusCanceled")}</option>
                          </select>
                          <button onClick={() => removeMember(m.id)} aria-label={t("memberships.removeMemberAria")} className="p-1.5 rounded-lg hover:bg-white/10">
                            <Trash2 className="h-4 w-4 text-red-400/70" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-white/40">{t("memberships.noMembers")}</p>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

    </div>
  );
}
