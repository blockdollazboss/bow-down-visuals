import { useCallback, useEffect, useState } from "react";
import { Check, Globe, Loader2, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  claimDomain,
  deleteDomain,
  dnsInstructionsFor,
  fetchMyDomains,
  verifyDomain,
  type CustomDomain,
  type VerifyResult,
} from "@/lib/domains";

/* ─── DomainsDesk — storefront custom domains, at the Marketplace
   stand's own-shop settings (Stack-100 #68). The creator-domains
   page is the reference implementation and this desk rides
   lib/domains' own helpers — the SAME calls the page makes:
   GET /api/domains/mine (the free subdomain + the caller's
   domains, each carrying its owner-only verification token),
   POST /api/domains to claim, POST /api/domains/:id/verify to
   check DNS, DELETE /api/domains/:id (two-step here, the World's
   delete discipline). The DNS instructions are rebuilt from the
   token with dnsInstructionsFor — the page's own client mirror of
   the server's instructions, placeholder warning included. A
   member with no creator page meets the page's own honest state
   ("build it first") instead of a broken form: the rail answers
   with a "creator page" error and the desk names it. */

export function DomainsDesk({ isLight }: { isLight: boolean }) {
  const { getAccessToken } = useAuth();
  const [domains, setDomains] = useState<CustomDomain[] | null>(null);
  const [freeSubdomain, setFreeSubdomain] = useState<string | null>(null);
  const [noProfile, setNoProfile] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hostname, setHostname] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, VerifyResult>>({});
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getAccessToken().catch(() => null);
      const data = await fetchMyDomains(token);
      setDomains(data.domains);
      setFreeSubdomain(data.free_subdomain);
      setNoProfile(false);
      setLoadFailed(false);
    } catch (e) {
      if (e instanceof Error && /creator page/i.test(e.message)) setNoProfile(true);
      else setLoadFailed(true);
    }
  }, [getAccessToken]);

  useEffect(() => { void load(); }, [load]);

  const claim = async () => {
    if (claiming || !hostname.trim()) return;
    setClaiming(true);
    setError(null);
    try {
      const token = await getAccessToken().catch(() => null);
      await claimDomain(token, hostname.trim());
      setHostname("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't claim it — try again.");
    } finally { setClaiming(false); }
  };

  const verify = async (domain: CustomDomain) => {
    if (verifyingId) return;
    setVerifyingId(domain.id);
    try {
      const token = await getAccessToken().catch(() => null);
      const result = await verifyDomain(token, domain.id);
      setVerifyResults((r) => ({ ...r, [domain.id]: result }));
      if (result.ok || result.already_active) await load();
    } catch (e) {
      setVerifyResults((r) => ({
        ...r,
        [domain.id]: { ok: false, message: e instanceof Error ? e.message : "The check didn't run — try again." },
      }));
    } finally { setVerifyingId(null); }
  };

  const remove = async (domain: CustomDomain) => {
    setDeletingId(domain.id);
    try {
      const token = await getAccessToken().catch(() => null);
      await deleteDomain(token, domain.id);
      setConfirmingDeleteId(null);
      await load();
    } catch { /* the reload (or its absence) tells the truth */ }
    finally { setDeletingId(null); }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const inputCls = `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
    isLight ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60" : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

  return (
    <div className="space-y-2 border-t border-dashed pt-3" data-testid="world-domains-desk">
      <p className={`flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        <Globe className="h-3.5 w-3.5" /> Your own domain
      </p>
      {noProfile ? (
        <p className={`text-xs ${muted}`}>
          Domains attach to your creator page — build it first (the Creator Rooms directory has the door), then claim your domain right here.
        </p>
      ) : loadFailed ? (
        <p className={`text-xs ${muted}`}>
          Couldn&rsquo;t load your domains — nothing about them changed.{" "}
          <button type="button" data-testid="world-domains-retry" onClick={() => void load()} className="font-bold text-[#d4af37]">Try again</button>
        </p>
      ) : domains === null ? (
        <p className={`inline-flex items-center gap-2 text-xs ${muted}`}>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> Reading your domains…
        </p>
      ) : (
        <>
          {freeSubdomain && (
            <p className={`text-xs ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
              Already yours, free forever: <span className="font-mono font-bold">{freeSubdomain}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <input aria-label="Custom domain" value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void claim(); }}
              placeholder="yourname.com" autoComplete="off" spellCheck={false}
              className={`${inputCls} min-w-44 flex-1 font-mono`} />
            <button type="button" data-testid="world-domains-claim" onClick={() => void claim()} disabled={claiming || !hostname.trim()}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50">
              {claiming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
              {claiming ? "Claiming…" : "Claim my domain"}
            </button>
          </div>
          {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
          {domains.length === 0 && (
            <p className={`text-[11px] ${muted}`}>No custom domains yet — your free subdomain above is already working, and your own .com is one claim away.</p>
          )}
          {domains.map((d) => {
            const dns = d.verification_token ? dnsInstructionsFor(d.hostname, d.verification_token) : null;
            const result = verifyResults[d.id];
            return (
              <div key={d.id} className={`rounded-xl border px-3 py-2.5 text-xs ${isLight ? "border-[#7A5A12]/25" : "border-white/10"}`}>
                <p className={`flex flex-wrap items-baseline justify-between gap-2 ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
                  <span className="font-mono font-bold">{d.hostname}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                    d.status === "active" ? "bg-emerald-500/15 text-emerald-300" : "bg-[#d4af37]/15 text-[#e8c86a]"
                  }`}>{d.status}{d.is_primary ? " · primary" : ""}</span>
                </p>
                {d.status !== "active" && dns && (
                  <div className={`mt-1.5 space-y-1 text-[11px] ${muted}`}>
                    <p>At your DNS provider, add:</p>
                    <p className="font-mono">{dns.cname.type} · {dns.cname.host} → {dns.cname.target}</p>
                    <p className="font-mono">{dns.txt.type} · {dns.txt.host} → {dns.txt.value}</p>
                    <p>{dns.ssl_note}</p>
                    {dns.placeholder_warning && (
                      <p className={isLight ? "text-[#92600a]" : "text-amber-300"}>{dns.placeholder_warning}</p>
                    )}
                  </div>
                )}
                {result && (
                  <p className={`mt-1.5 text-[11px] font-semibold ${result.ok || result.already_active ? isLight ? "text-emerald-700" : "text-emerald-300" : isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                    {result.message}
                    {result.checks ? ` (CNAME ${result.checks.cname ? "✓" : "✗"} · TXT ${result.checks.txt ? "✓" : "✗"})` : ""}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {d.status !== "active" && (
                    <button type="button" data-testid="world-domains-verify" onClick={() => void verify(d)} disabled={verifyingId !== null}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-[11px] font-bold text-black transition hover:scale-105 disabled:opacity-50">
                      {verifyingId === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      {verifyingId === d.id ? "Checking…" : "Check now"}
                    </button>
                  )}
                  {confirmingDeleteId === d.id ? (
                    <>
                      <button type="button" data-testid="world-domains-delete-confirm" onClick={() => void remove(d)} disabled={deletingId !== null}
                        className="rounded-full border border-red-400/50 bg-red-400/10 px-3 py-1.5 text-[11px] font-bold text-red-300 disabled:opacity-50">
                        {deletingId === d.id ? "Removing…" : "Remove it?"}
                      </button>
                      <button type="button" onClick={() => setConfirmingDeleteId(null)} className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"}`}>Keep</button>
                    </>
                  ) : (
                    <button type="button" data-testid="world-domains-delete" onClick={() => setConfirmingDeleteId(d.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-red-400/40 px-3 py-1.5 text-[11px] font-bold text-red-300">
                      <Trash2 className="h-3 w-3" /> Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
