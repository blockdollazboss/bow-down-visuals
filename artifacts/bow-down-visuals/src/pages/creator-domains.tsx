import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Globe, Copy, Check, ExternalLink, Trash2, ShieldCheck, Sparkles,
  Loader2, CircleDollarSign, Share2, ChevronDown,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchMyDomains, claimDomain, verifyDomain, deleteDomain,
  dnsInstructionsFor,
  type CustomDomain, type VerifyResult, type DnsInstructions,
} from "@/lib/domains";

/* ─── Creator Domains — Worker 10: the "own website" flagship ────────────────
   DIFFICULTY LADDER (standing): 1-star simple by default — type your domain,
   paste two records, hit Check now. The raw DNS record tables sit behind
   data-min-stars="4" (Shot Caller and up). The Check now / go-live path is
   NEVER gated: once verified, the site is live, no upsell in the way.

   GET PAID FINALE (standing — "guide them to the money"): a verified domain
   ends in the Get Paid checklist: "your site is live at yourname.com — now
   price your first product."

   Suggested route (coordinator wires): /creator/domains wrapped in
   <ProtectedRoute>. All links relative; gold/black luxury; cheat-code voice.
*/

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard unavailable — user can select manually */ }
      }}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-400/40 px-3 py-1.5 text-xs font-bold text-amber-300 transition hover:bg-amber-400/10"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : (label ?? "Copy")}
    </button>
  );
}

function StatusChip({ status }: { status: CustomDomain["status"] }) {
  const styles: Record<CustomDomain["status"], string> = {
    pending: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    verifying: "border-sky-400/40 bg-sky-400/10 text-sky-300",
    active: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    failed: "border-red-400/40 bg-red-400/10 text-red-300",
  };
  const labels: Record<CustomDomain["status"], string> = {
    pending: "Waiting on DNS",
    verifying: "Checking…",
    active: "Live",
    failed: "Needs attention",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${styles[status]}`}>
      {status === "verifying" && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === "active" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
      {labels[status]}
    </span>
  );
}

/** Friendly record row: what to paste where (1-star view). Raw table is 4★+. */
function RecordRow({ kind, host, value }: { kind: "CNAME" | "TXT"; host: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded bg-amber-400/15 px-2 py-0.5 font-mono text-xs font-bold text-amber-300">{kind}</span>
        <CopyButton text={value} />
      </div>
      <div className="space-y-1 font-mono text-xs">
        <div className="flex flex-wrap gap-x-2">
          <span className="text-white/40">Name / Host:</span>
          <span className="break-all text-white">{host}</span>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <span className="text-white/40">{kind === "CNAME" ? "Points to:" : "Value:"}</span>
          <span className="break-all text-amber-200">{value}</span>
        </div>
      </div>
    </div>
  );
}

function DnsEvidencePanel({ result }: { result: VerifyResult }) {
  const [open, setOpen] = useState(true);
  if (result.ok || !result.expected) return null;
  const { expected, found } = result;
  const cnameFound = found?.cname?.length ? found.cname.join(", ") : null;
  const cnameErr = found?.errors?.["cname"];
  const txtCount = found?.txt?.length ?? 0;
  const txtErr = found?.errors?.["txt"];
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-4 text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between font-bold text-white"
      >
        <span>Here's what we see right now</span>
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-3 text-xs">
          <div className="rounded-lg bg-white/[0.04] p-3">
            <div className="mb-1 font-bold text-white/70">CNAME record</div>
            <div className="font-mono"><span className="text-white/40">Expected → </span><span className="text-amber-200">{expected.cname_target}</span></div>
            <div className="font-mono"><span className="text-white/40">We see → </span>
              <span className="text-white">{cnameFound ?? (cnameErr === "ENOTFOUND" ? "no record yet" : `lookup ${cnameErr ?? "failed"}`)}</span>
            </div>
          </div>
          <div className="rounded-lg bg-white/[0.04] p-3">
            <div className="mb-1 font-bold text-white/70">TXT proof record</div>
            <div className="font-mono"><span className="text-white/40">Expected at → </span><span className="text-amber-200">{expected.txt_host}</span></div>
            <div className="font-mono"><span className="text-white/40">We see → </span>
              <span className="text-white">
                {txtCount > 0 ? `${txtCount} TXT record${txtCount === 1 ? "" : "s"} — none match your token yet` : (txtErr === "ENOTFOUND" ? "no record yet" : `lookup ${txtErr ?? "failed"}`)}
              </span>
            </div>
          </div>
          <p className="text-white/50">DNS can take a few minutes (sometimes up to an hour) to spread worldwide. Match the records exactly, then hit Check now again. 🦈</p>
        </div>
      )}
    </div>
  );
}

function GetPaidFinale({ hostname }: { hostname: string }) {
  const siteUrl = `https://${hostname}`;
  return (
    <div className="rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-400/15 via-transparent to-transparent p-5">
      <div className="mb-1 flex items-center gap-2 font-bold text-amber-300">
        <CircleDollarSign className="h-5 w-5" />
        Your site is live at {hostname} — now price your first product.
      </div>
      <p className="mb-4 text-sm text-white/60">
        The "own website" feeling <em>is</em> the money feeling. Your whole universe — page, store, content — now lives behind your name. Finish the job:
      </p>
      <ol className="space-y-3 text-sm">
        <li className="flex items-center gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300"><Check className="h-3.5 w-3.5" /></span>
          <span className="text-white/80">Site live at <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="font-bold text-amber-300 underline decoration-dotted underline-offset-2">{hostname}</a></span>
        </li>
        <li className="flex items-center gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-400/40 text-xs font-bold text-amber-300">2</span>
          <Link href="/storefronts" className="font-bold text-white underline decoration-amber-400/50 decoration-dotted underline-offset-2 hover:text-amber-300">
            Price your first product →
          </Link>
        </li>
        <li className="flex items-center gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-400/40 text-xs font-bold text-amber-300">3</span>
          <span className="flex flex-wrap items-center gap-2 text-white/80">
            <Share2 className="h-4 w-4 text-amber-300" /> Tell your fans — share your link:
            <CopyButton text={siteUrl} label="Copy site link" />
          </span>
        </li>
      </ol>
    </div>
  );
}

function DomainCard({
  domain,
  token,
  onChanged,
}: {
  domain: CustomDomain;
  token: string | null;
  onChanged: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lastCheck, setLastCheck] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dns: DnsInstructions | null =
    domain.status === "pending" || domain.status === "verifying" || domain.status === "failed"
      ? dnsInstructionsFor(domain.hostname, domain.verification_token ?? "")
      : null;

  const checkNow = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const r = await verifyDomain(token, domain.id);
      setLastCheck(r);
      onChanged(); // refresh statuses from the server
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check failed — try again.");
    } finally {
      setChecking(false);
    }
  }, [token, domain.id, onChanged]);

  const remove = useCallback(async () => {
    if (!window.confirm(`Release ${domain.hostname}? Your free subdomain keeps working.`)) return;
    setDeleting(true);
    try {
      await deleteDomain(token, domain.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't release it — try again.");
      setDeleting(false);
    }
  }, [token, domain.id, domain.hostname, onChanged]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-amber-400" />
          <span className="font-mono text-lg font-bold text-white">{domain.hostname}</span>
          {domain.is_primary && (
            <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold text-amber-300">PRIMARY</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusChip status={domain.status} />
          <button
            type="button"
            onClick={remove}
            disabled={deleting}
            title="Release this domain"
            className="rounded-full border border-white/10 p-2 text-white/40 transition hover:border-red-400/50 hover:text-red-300"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-300">{error}</p>}

      {domain.status === "active" ? (
        <GetPaidFinale hostname={domain.hostname} />
      ) : (
        dns && (
          <div className="space-y-4">
            <p className="text-sm text-white/70">
              <span className="font-bold text-white">Two quick pastes</span> where you bought your domain (GoDaddy, Namecheap, Cloudflare…), then hit Check now:
            </p>
            {dns.placeholder_warning && (
              <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">{dns.placeholder_warning}</p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <RecordRow kind="CNAME" host={dns.cname.host} value={dns.cname.target ?? ""} />
              <RecordRow kind="TXT" host={dns.txt.host} value={dns.txt.value ?? ""} />
            </div>

            {/* 4★+: the raw records, exactly as the server sees them */}
            <div data-min-stars="4" className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-left text-white/40">
                    <th className="p-3 font-bold">Type</th>
                    <th className="p-3 font-bold">Name</th>
                    <th className="p-3 font-bold">Value</th>
                    <th className="p-3 font-bold">TTL</th>
                  </tr>
                </thead>
                <tbody className="text-white/80">
                  <tr className="border-b border-white/5">
                    <td className="p-3 text-amber-300">CNAME</td>
                    <td className="p-3">{dns.cname.host}</td>
                    <td className="p-3 break-all">{dns.cname.target}</td>
                    <td className="p-3 text-white/40">Auto</td>
                  </tr>
                  <tr>
                    <td className="p-3 text-amber-300">TXT</td>
                    <td className="p-3">{dns.txt.host}</td>
                    <td className="p-3 break-all">{dns.txt.value}</td>
                    <td className="p-3 text-white/40">Auto</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {lastCheck && !lastCheck.ok && <DnsEvidencePanel result={lastCheck} />}

            {/* Primary CTA — never gated, at any star level */}
            <button
              type="button"
              onClick={checkNow}
              disabled={checking}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-amber-400 px-6 py-3 text-sm font-black text-black transition hover:scale-[1.02] disabled:opacity-60"
            >
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {checking ? "Asking the DNS gods…" : "Check now — take me live"}
            </button>
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-white/40">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> {dns.ssl_note}
            </p>
          </div>
        )
      )}
    </div>
  );
}

export default function CreatorDomainsPage() {
  const { getAccessToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [domains, setDomains] = useState<CustomDomain[]>([]);
  const [freeSubdomain, setFreeSubdomain] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hostname, setHostname] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noProfile, setNoProfile] = useState(false);

  const refresh = useCallback(async () => {
    const t = await getAccessToken().catch(() => null);
    setToken(t);
    if (!t) {
      setLoading(false);
      return;
    }
    try {
      const data = await fetchMyDomains(t);
      setDomains(data.domains);
      setFreeSubdomain(data.free_subdomain);
      setNoProfile(false);
    } catch (e) {
      if (e instanceof Error && /creator page/i.test(e.message)) setNoProfile(true);
      else setError(e instanceof Error ? e.message : "Couldn't load your domains.");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const claim = useCallback(async () => {
    setError(null);
    setClaiming(true);
    try {
      await claimDomain(token, hostname);
      setHostname("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't claim it — try again.");
    } finally {
      setClaiming(false);
    }
  }, [token, hostname, refresh]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 text-center">
        <div className="mb-2 flex items-center justify-center gap-2">
          <Globe className="h-7 w-7 text-amber-400" />
          <h1 className="bg-gradient-to-r from-amber-200 via-amber-400 to-amber-200 bg-clip-text text-3xl font-black text-transparent">
            Your own website
          </h1>
        </div>
        <p className="mx-auto max-w-md text-sm text-white/60">
          Your name, your rules. Point your domain here and your whole creator universe — page, store, content — lives behind it. 🦈
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-amber-400" /></div>
      ) : noProfile ? (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-8 text-center">
          <p className="mb-4 text-white/80">Domains attach to your creator page — build it first (takes two minutes).</p>
          <Link href="/artist-setup" className="inline-block rounded-full bg-amber-400 px-6 py-2.5 text-sm font-black text-black transition hover:scale-105">
            Build my creator page
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Free subdomain — already live */}
          {freeSubdomain && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-5">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-300">Already yours — free forever</div>
                <div className="font-mono text-lg font-bold text-white">{freeSubdomain}</div>
              </div>
              <div className="flex gap-2">
                <CopyButton text={`https://${freeSubdomain}`} />
                <a
                  href={`https://${freeSubdomain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-400/25"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Visit
                </a>
              </div>
            </div>
          )}

          {/* Claim a new domain — 1-star simple */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="mb-1 font-bold text-white">Connect your own domain</h2>
            <p className="mb-4 text-sm text-white/60">Type it, claim it, paste two records, hit Check now. That's the whole ritual.</p>
            {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && hostname.trim()) claim(); }}
                placeholder="yourname.com"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 rounded-full border border-white/15 bg-black/50 px-5 py-3 font-mono text-sm text-white placeholder:text-white/30 focus:border-amber-400/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={claim}
                disabled={claiming || !hostname.trim()}
                className="rounded-full bg-amber-400 px-6 py-3 text-sm font-black text-black transition hover:scale-[1.02] disabled:opacity-50"
              >
                {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : "Claim my domain"}
              </button>
            </div>
          </div>

          {/* Domain cards */}
          {domains.map((d) => (
            <DomainCard key={d.id} domain={d} token={token} onChanged={refresh} />
          ))}

          {domains.length === 0 && (
            <p className="text-center text-sm text-white/40">
              No custom domains yet — your free subdomain above is already working, and your own .com is one claim away.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
