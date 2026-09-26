import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Store, Loader2, Sparkles, ArrowRight, ArrowLeft, Check, Globe,
  Copy, BadgeCheck, Crown, AlertTriangle, ShoppingBag, Plus, X,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { usePageTitle } from "@/hooks/use-page-title";
import { centsToDisplay, dollarsToCents } from "@/lib/shops";

/* ─── Storefront Builder — AI-assisted shop setup wizard ───────────────────
   5 steps: identity → branding → AI description (1cr) → products → domain + launch.
   Shop creation itself is gated to Pro+ on the server; the wizard surfaces
   the upgrade path instead of a dead end. */

const STEPS = ["Identity", "Branding", "AI Description", "Products", "Domain & Launch"];

const COLOR_PRESETS = [
  { name: "Gold Noir", banner: "#0a0a0a", accent: "#d4af37" },
  { name: "Royal Purple", banner: "#150a24", accent: "#a855f7" },
  { name: "Crimson", banner: "#1c0a0a", accent: "#ef4444" },
  { name: "Ocean", banner: "#08131c", accent: "#38bdf8" },
  { name: "Emerald", banner: "#071410", accent: "#34d399" },
  { name: "Rose", banner: "#190b12", accent: "#fb7185" },
];

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-amber-400/60 focus:ring-1 focus:ring-amber-400/40";
const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-5 py-3 text-sm font-bold text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none";
const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-50 disabled:pointer-events-none";

interface DraftProduct { name: string; price: string; description: string; }

export default function StorefrontBuilder() {
  usePageTitle("Build Your Storefront");
  const { user, getAccessToken } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [, navigate] = useLocation();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [tagline, setTagline] = useState("");
  const [bannerColor, setBannerColor] = useState("#0a0a0a");
  const [accentColor, setAccentColor] = useState("#d4af37");
  const [description, setDescription] = useState("");
  const [niche, setNiche] = useState("");
  const [products, setProducts] = useState<DraftProduct[]>([{ name: "", price: "", description: "" }]);
  const [shopId, setShopId] = useState<string | null>(null);
  const [createdHandle, setCreatedHandle] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tierBlocked, setTierBlocked] = useState(false);

  /* domain state (step 5) */
  const [domain, setDomain] = useState("");
  const [domainInfo, setDomainInfo] = useState<{ domain: string; verification: { host: string; value: string }; dns: { step1: string; step2: string; step3: string } } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [domainVerified, setDomainVerified] = useState(false);
  const [copied, setCopied] = useState("");

  async function authed(path: string, init?: RequestInit) {
    const token = await getAccessToken();
    return fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
  }

  const cleanHandle = handle.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");

  async function createShop() {
    setError(null); setTierBlocked(false); setBusy(true);
    try {
      const res = await authed("/api/shops", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), handle: cleanHandle, tagline: tagline.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data.error === "PRO_TIER_REQUIRED") { setTierBlocked(true); return; }
      if (!res.ok) throw new Error(data.error || "Couldn't create your shop.");
      const shop = data.shop;
      setShopId(shop.id); setCreatedHandle(shop.handle);
      /* apply branding immediately */
      await authed(`/api/shops/${shop.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          description: description.trim() || undefined,
          banner_color: bannerColor, accent_color: accentColor,
        }),
      });
      /* add draft products */
      for (const p of products) {
        if (!p.name.trim()) continue;
        const cents = dollarsToCents(p.price);
        await authed(`/api/shops/${shop.id}/products`, {
          method: "POST",
          body: JSON.stringify({
            name: p.name.trim(),
            price_cents: cents ?? 0,
            description: p.description.trim(),
          }),
        });
      }
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally { setBusy(false); }
  }

  async function generateDescription() {
    setError(null);
    const res = await confirmedFetch("/api/shops/ai/shop-description", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopName: name.trim(), tagline: tagline.trim(), niche: niche.trim(), products: products.map((p) => p.name).filter(Boolean).join(", ") }),
      overrideCost: 1, overrideFeature: "AI Shop Description",
    });
    if (!res) return; // user cancelled
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || "AI description failed."); return; }
    setDescription(data.description ?? "");
  }

  async function attachDomain() {
    if (!shopId || !domain.trim()) return;
    setError(null); setBusy(true);
    try {
      const res = await authed(`/api/storefronts/${shopId}/domain`, {
        method: "POST", body: JSON.stringify({ domain: domain.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't attach that domain.");
      setDomainInfo(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Domain attach failed."); }
    finally { setBusy(false); }
  }

  async function verifyDomain() {
    if (!shopId) return;
    setVerifying(true); setError(null);
    try {
      const res = await authed("/api/storefronts/domain/verify", {
        method: "POST", body: JSON.stringify({ shopId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.verified) { setDomainVerified(true); }
      else setError(data.reason || "Not verified yet — DNS can take a few minutes.");
    } catch { setError("Verification check failed. Try again."); }
    finally { setVerifying(false); }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key); setTimeout(() => setCopied(""), 1500);
  }

  const canNext1 = name.trim().length >= 2 && /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/.test(cleanHandle);

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-10">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-amber-300">
            <Store className="h-3.5 w-3.5" /> Storefront Builder
          </div>
          <h1 className="mt-4 text-3xl font-black sm:text-4xl">
            Open your <span className="bg-gradient-to-b from-amber-200 to-amber-500 bg-clip-text text-transparent">own shop</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/55">
            Your brand, your products, your domain. Bow Down Visuals takes a
            flat <span className="font-bold text-amber-300">10% platform fee</span> on each
            sale — you keep 90%. Requires a <span className="font-bold text-white/80">Pro plan or higher</span>.
          </p>
        </div>

        {/* stepper */}
        <div className="mt-8 flex items-center justify-center gap-1.5">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1.5">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition ${i < step ? "bg-amber-400 text-black" : i === step ? "border-2 border-amber-400 text-amber-300" : "border border-white/15 text-white/30"}`}>
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`hidden text-xs font-semibold sm:block ${i === step ? "text-amber-300" : "text-white/35"}`}>{s}</span>
              {i < STEPS.length - 1 && <div className="mx-1 h-px w-6 bg-white/10 sm:w-10" />}
            </div>
          ))}
        </div>

        {error && (
          <div className="mt-6 flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {tierBlocked ? (
          <div className="lux-card mt-6 p-8 text-center">
            <Crown className="mx-auto h-10 w-10 text-amber-400" />
            <h2 className="mt-4 text-xl font-bold">Storefronts are a Pro feature</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-white/55">
              Opening your own shop requires a <span className="font-bold text-white/85">Pro plan or higher</span>.
              Upgrade and your shop is one click away.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/pricing"><span className={`${goldBtn} cursor-pointer`}><Crown className="h-4 w-4" /> See Pro plans</span></Link>
              <Link href="/storefronts"><span className={`${ghostBtn} cursor-pointer`}>Browse shops</span></Link>
            </div>
          </div>
        ) : (
          <div className="lux-card mt-6 p-6 sm:p-8">
            {!user && (
              <div className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
                <Link href="/login"><span className="cursor-pointer font-bold underline">Sign in</span></Link> to build your shop — it takes 2 minutes.
              </div>
            )}

            {/* STEP 1 — identity */}
            {step === 0 && (
              <div>
                <h2 className="text-lg font-bold">Name your shop</h2>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/50">Shop name</label>
                    <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. TRBLZ Merch Co." maxLength={80} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/50">Handle — your storefront URL</label>
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 font-mono text-sm text-white/40">/shop/</span>
                      <input className={`${inputClass} font-mono`} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="trblz-merch" maxLength={30} />
                    </div>
                    {handle && !/^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/.test(cleanHandle) && (
                      <p className="mt-1 text-xs text-red-300">Lowercase letters, numbers, hyphens — 3–30 characters.</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/50">Tagline</label>
                    <input className={inputClass} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Official merch & music drops" maxLength={140} />
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2 — branding */}
            {step === 1 && (
              <div>
                <h2 className="text-lg font-bold">Brand it</h2>
                <p className="mt-1 text-sm text-white/50">Pick a theme — or dial in your own colors.</p>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => { setBannerColor(c.banner); setAccentColor(c.accent); }}
                      className={`rounded-xl border p-3 text-left transition ${bannerColor === c.banner && accentColor === c.accent ? "border-amber-400 ring-1 ring-amber-400/50" : "border-white/10 hover:border-white/25"}`}
                      style={{ background: `linear-gradient(135deg, ${c.banner}, #111)` }}
                    >
                      <div className="h-6 w-6 rounded-full" style={{ background: c.accent }} />
                      <div className="mt-2 text-xs font-bold">{c.name}</div>
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/50">Banner color</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={bannerColor} onChange={(e) => setBannerColor(e.target.value)} className="h-10 w-14 cursor-pointer rounded-lg border border-white/15 bg-black" />
                      <span className="font-mono text-xs text-white/50">{bannerColor}</span>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/50">Accent color</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="h-10 w-14 cursor-pointer rounded-lg border border-white/15 bg-black" />
                      <span className="font-mono text-xs text-white/50">{accentColor}</span>
                    </div>
                  </div>
                </div>
                {/* live preview */}
                <div className="mt-5 overflow-hidden rounded-xl border border-white/10">
                  <div className="flex h-24 items-end p-4" style={{ background: `linear-gradient(135deg, ${bannerColor}, #111)` }}>
                    <span className="rounded-full px-3 py-1 text-[11px] font-bold text-black" style={{ background: accentColor }}>{name || "Your Shop"}</span>
                  </div>
                  <div className="bg-black/60 p-4">
                    <div className="font-bold" style={{ color: accentColor }}>{name || "Your Shop"}</div>
                    <div className="font-mono text-xs text-white/40">/shop/{cleanHandle || "your-handle"}</div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3 — AI description */}
            {step === 2 && (
              <div>
                <h2 className="text-lg font-bold">Tell your story</h2>
                <p className="mt-1 text-sm text-white/50">
                  Let AI write your shop's "about" blurb — <span className="font-bold text-amber-300">1 credit</span>. Or write your own for free.
                </p>
                <div className="mt-4">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/50">What do you sell? (helps the AI)</label>
                  <input className={inputClass} value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Streetwear, vinyl pressings, sample packs…" maxLength={120} />
                </div>
                <button className={`${goldBtn} mt-3`} onClick={generateDescription} disabled={busy || !name.trim()}>
                  <Sparkles className="h-4 w-4" /> Generate with AI <span className="text-[11px] font-semibold opacity-70">1 credit</span>
                </button>
                <div className="mt-4">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/50">Shop description</label>
                  <textarea className={`${inputClass} min-h-28`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="The official home of…" maxLength={2000} />
                </div>
              </div>
            )}

            {/* STEP 4 — products */}
            {step === 3 && (
              <div>
                <h2 className="text-lg font-bold">Add products</h2>
                <p className="mt-1 text-sm text-white/50">Start with a few — you can add images and more later in <Link href="/my-shop"><span className="cursor-pointer text-amber-300 underline">My Shop</span></Link>.</p>
                <div className="mt-4 space-y-3">
                  {products.map((p, i) => (
                    <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-white/40">Product {i + 1}</span>
                        {products.length > 1 && (
                          <button className="text-white/40 hover:text-red-300" onClick={() => setProducts(products.filter((_, j) => j !== i))}>
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        <input className={inputClass} value={p.name} onChange={(e) => setProducts(products.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Product name" maxLength={120} />
                        <input className={inputClass} value={p.price} onChange={(e) => setProducts(products.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} placeholder="Price (USD)" inputMode="decimal" />
                      </div>
                      <input className={`${inputClass} mt-3`} value={p.description} onChange={(e) => setProducts(products.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} placeholder="Short description (optional)" maxLength={500} />
                      {p.price && dollarsToCents(p.price) != null && (
                        <p className="mt-1.5 text-xs text-white/40">
                          Listed at <span className="font-bold text-white/70">{centsToDisplay(dollarsToCents(p.price)!)}</span> · you keep <span className="font-bold text-emerald-300">{centsToDisplay(Math.round(dollarsToCents(p.price)! * 0.9))}</span> after the 10% platform fee
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <button className={`${ghostBtn} mt-3`} onClick={() => setProducts([...products, { name: "", price: "", description: "" }])}>
                  <Plus className="h-4 w-4" /> Add another
                </button>
              </div>
            )}

            {/* STEP 5 — domain & launch */}
            {step === 4 && (
              <div>
                <h2 className="text-lg font-bold">Launch it 🚀</h2>
                <p className="mt-1 text-sm text-white/50">
                  Your shop is live at <span className="font-mono text-amber-300">/shop/{createdHandle}</span>.
                  Connect your own domain for the full brand experience.
                </p>

                <div className="mt-5 rounded-xl border border-white/10 bg-black/40 p-5">
                  <div className="flex items-center gap-2 text-sm font-bold"><Globe className="h-4 w-4 text-amber-300" /> Custom domain</div>
                  {!domainInfo ? (
                    <div className="mt-3 flex gap-2">
                      <input className={inputClass} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="shop.yourname.com" />
                      <button className={goldBtn} onClick={attachDomain} disabled={busy || !domain.trim()}>Connect</button>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3 text-sm">
                      <div className="rounded-lg border border-white/10 bg-black/60 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs uppercase tracking-wider text-white/40">Step 1 — TXT record (proves you own it)</span>
                          <button className="text-xs font-bold text-amber-300 hover:text-amber-200" onClick={() => copy(domainInfo.verification.value, "txt")}>
                            {copied === "txt" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        <p className="mt-1 font-mono text-xs text-white/80">Host: <span className="text-amber-300">{domainInfo.verification.host}</span></p>
                        <p className="mt-1 break-all font-mono text-xs text-white/80">Value: <span className="text-amber-300">{domainInfo.verification.value}</span></p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-black/60 p-3">
                        <div className="text-xs uppercase tracking-wider text-white/40">Step 2 — CNAME record (points it at your shop)</div>
                        <p className="mt-1 font-mono text-xs text-white/80">Host: <span className="text-amber-300">@</span> → <span className="text-amber-300">cname.bowdownvisuals.com</span></p>
                      </div>
                      <p className="text-xs text-white/45">{domainInfo.dns.step3}</p>
                      <button className={goldBtn} onClick={verifyDomain} disabled={verifying}>
                        {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : domainVerified ? <BadgeCheck className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                        {domainVerified ? "Domain verified!" : "Verify domain"}
                      </button>
                      {domainVerified && (
                        <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                          <BadgeCheck className="h-4 w-4" /> {domainInfo.domain} is connected to your shop.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  <button className={goldBtn} onClick={() => navigate(`/shop/${createdHandle}`)}>
                    <ArrowRight className="h-4 w-4" /> View your live shop
                  </button>
                  <Link href="/my-shop"><span className={`${ghostBtn} cursor-pointer`}><ShoppingBag className="h-4 w-4" /> Manage in My Shop</span></Link>
                </div>
              </div>
            )}

            {/* nav buttons */}
            {step < 4 && (
              <div className="mt-8 flex items-center justify-between">
                <button className={ghostBtn} onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                {step < 3 ? (
                  <button className={goldBtn} onClick={() => setStep(step + 1)} disabled={step === 0 && !canNext1 || !user}>
                    Continue <ArrowRight className="h-4 w-4" />
                  </button>
                ) : (
                  <button className={goldBtn} onClick={createShop} disabled={busy || !user}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
                    Create my shop
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
