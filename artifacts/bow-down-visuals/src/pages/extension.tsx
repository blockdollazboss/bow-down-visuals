import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarketingBadge } from "@/components/MarketingBadge";
import { LuxReveal } from "@/components/LuxReveal";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { markExtensionDownloaded } from "@/lib/extension-promo";
import {
  MessageCircle, Wrench, Search, Wallet, Download,
  Bell, Check, Puzzle, Zap, MousePointerClick, BellRing,
} from "lucide-react";

/* ─── Thy Cheat Code browser extension promo page ─── */
/* Coming soon to the Chrome Web Store. Email notify-me form posts to the
   existing /api/waitlist endpoint with an extension message so launch
   notifications go to the right list. */

const TABS = [
  {
    icon: MessageCircle, name: "Chat",
    body: "Thy Cheat Code in your toolbar. Ask anything, attach the page you're on as context, and get answers without leaving your flow.",
  },
  {
    icon: Wrench, name: "Tools",
    body: "Every tool on the site — 100+ across video, music, thumbnails, branding, promotion and money — searchable and one click away.",
  },
  {
    icon: Search, name: "Analyze",
    body: "AI breakdowns of any page, YouTube thumbnail analysis, and competitor snapshots for any social profile.",
  },
  {
    icon: Wallet, name: "Money",
    body: "Claim your daily bonus, spin the jackpot wheel, copy your referral link and check Visual Buc usage — all from the popup.",
  },
  {
    icon: Download, name: "Saved",
    body: "Right-click anything on the web — images, videos, links — and it lands in your Saved tab instantly.",
  },
];

const PERKS = [
  { icon: Zap, title: "Right-click AI", body: "Generate hooks from selected text, caption any image, analyze any page — from the context menu." },
  { icon: MousePointerClick, title: "YouTube + TikTok + Instagram", body: "Analyze thumbnails, save videos, repurpose content without leaving the watch page." },
  { icon: BellRing, title: "Never miss free credits", body: "Daily bonus and hourly wheel spins live in the popup — claim them while you browse." },
];

const FAQS = [
  { q: "When does it launch?", a: "You can download it right now from this page and load it unpacked in Chrome in 30 seconds. The one-click Chrome Web Store install is coming — join the notify list and we'll email you the day it drops." },
  { q: "How much does it cost?", a: "The extension itself is free. AI features inside it use your site's Visual Bucs at the same rates as the website — pure browsing and saving costs nothing." },
  { q: "Do I need a Bow Down Visuals account?", a: "Yes — the extension signs in with your site session, so your credits, bonuses and referrals all carry over." },
  { q: "Which browsers are supported?", a: "Google Chrome at launch. Chromium-based browsers (Edge, Brave, Arc) can load it unpacked on day one." },
];

const GUIDE_STEPS = [
  { title: "Download the zip", body: "Hit the gold Download button above. It's a tiny file (under 100KB)." },
  { title: "Unzip it", body: "Double-click the zip (Mac) or right-click → Extract all (Windows). You'll get a folder called bow-down-visuals-extension-v2." },
  { title: "Open chrome://extensions", body: "Type chrome://extensions in your address bar and hit Enter." },
  { title: "Turn on Developer mode", body: "Top-right corner toggle. This lets Chrome load extensions from a folder." },
  { title: "Click “Load unpacked”", body: "Select the unzipped bow-down-visuals-extension-v2 folder. The 🦈 icon appears in your toolbar." },
  { title: "Pin it", body: "Click the puzzle-piece icon in Chrome's toolbar and pin Thy Cheat Code so it's always one click away." },
  { title: "Sign in on the site", body: "Open bowdownvisuals.com and sign in first — the extension reuses your site session for credits, bonuses and referrals." },
];

const GUIDE_FIXES = [
  { q: "The 🦈 icon isn't in my toolbar", a: "Click the puzzle-piece icon (Extensions menu) in Chrome's toolbar and pin “Bow Down Visuals — Content Creator Cheat Code”." },
  { q: "“You're not signed in”", a: "Open bowdownvisuals.com in a Chrome tab and sign in, then click the extension icon again. The extension borrows your site session." },
  { q: "Chrome blocked the install", a: "You must use “Load unpacked” with Developer mode on — don't drag the zip into Chrome. Unzip first, then select the folder." },
];

const inputClass = "h-12 bg-white/[0.05] border-white/[0.10] text-white placeholder:text-white/30 focus:border-primary/50 rounded-xl text-sm";

export default function Extension() {
  usePageTitle("Thy Cheat Code Browser Extension — Coming Soon | Bow Down Visuals");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.includes("@")) {
      setError("Please enter your name and a valid email.");
      setState("error");
      return;
    }
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          artistType: "Content Creator",
          message: "Notify me about the Thy Cheat Code Chrome extension launch.",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error === "duplicate_email" ? "You're already on the list. 🦈" : (data.message || data.error || "Something went wrong."));
        setState("error");
        return;
      }
      setState("done");
    } catch {
      setError("Couldn't reach the site. Try again in a moment.");
      setState("error");
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Thy Cheat Code Browser Extension",
        url: "https://bowdownvisuals.com/extension",
        description: "The Bow Down Visuals creator command center, in your browser. Download now for Chrome.",
      }} />

      {/* Hero */}
      <section className="relative overflow-hidden px-5 pt-24 pb-16 md:pt-32 md:pb-24">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[#C9A84C]/10 rounded-full blur-[120px] pointer-events-none" />
        <LuxReveal className="relative z-10 max-w-4xl mx-auto text-center space-y-6">
          <MarketingBadge variant="kicker">
            <Puzzle className="h-3.5 w-3.5 mr-1.5" /> Download now · Chrome Web Store soon
          </MarketingBadge>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight">
            Thy Cheat Code, <span className="text-[#e8c86a]">in your browser.</span>
          </h1>
          <p className="text-white/60 text-lg md:text-xl max-w-2xl mx-auto">
            The entire Bow Down Visuals creator command center — AI chat, every site tool,
            money hub and one-click saving — living in your Chrome toolbar.
          </p>

          <div className="max-w-md mx-auto pt-4 space-y-4">
            <a
              href="/bow-down-visuals-extension-v2.zip"
              download
              onClick={markExtensionDownloaded}
              className="flex items-center justify-center gap-2 w-full h-13 rounded-xl bg-gradient-to-r from-[#C9A84C] to-[#e8c86a] px-8 py-4 text-black font-bold text-lg hover:brightness-110 transition shadow-[0_0_30px_rgba(201,168,76,0.3)]"
            >
              <Download className="h-5 w-5" />
              Download for Chrome — v2.0
            </a>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left">
              <p className="font-semibold text-sm mb-2">Load it in 30 seconds:</p>
              <ol className="text-white/55 text-sm space-y-1.5 list-decimal list-inside">
                <li>Unzip the downloaded file</li>
                <li>Open <span className="text-white font-mono text-xs">chrome://extensions</span> in Chrome</li>
                <li>Turn on <span className="text-white">Developer mode</span> (top right)</li>
                <li>Click <span className="text-white">Load unpacked</span> → select the unzipped folder</li>
              </ol>
              <p className="text-white/30 text-xs mt-3">Sign in on bowdownvisuals.com first — the extension uses your site session.</p>
            </div>

            <div className="pt-2">
              <p className="text-white/40 text-sm mb-3">Rather wait for the one-click install?</p>
            {state === "done" ? (
              <div className="rounded-2xl border border-[#C9A84C]/40 bg-[#C9A84C]/10 p-6 text-center">
                <Check className="h-8 w-8 text-[#e8c86a] mx-auto mb-2" />
                <p className="font-semibold text-lg">You're on the list. 🦈</p>
                <p className="text-white/60 text-sm mt-1">We'll email you the install link the day it launches.</p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <Input className={inputClass} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
                <Input className={inputClass} placeholder="Email for the launch link" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} />
                <Button type="submit" disabled={state === "sending"} className="w-full h-12 rounded-xl bg-gradient-to-r from-[#C9A84C] to-[#e8c86a] text-black font-bold text-base hover:brightness-110 transition">
                  <Bell className="h-4 w-4 mr-2" />
                  {state === "sending" ? "Joining…" : "Notify me at launch"}
                </Button>
                {state === "error" && <p className="text-red-400/90 text-sm">{error}</p>}
                <p className="text-white/30 text-xs">One email when it launches. No spam, ever.</p>
              </form>
            )}
            </div>
          </div>
        </LuxReveal>
      </section>

      {/* Install guide */}
      <section className="px-5 py-16 md:py-20 border-t border-white/5">
        <div className="max-w-4xl mx-auto">
          <LuxReveal className="text-center mb-10">
            <MarketingBadge variant="kicker">Install guide</MarketingBadge>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mt-4">
              Up and running <span className="text-[#e8c86a]">in 30 seconds.</span>
            </h2>
          </LuxReveal>
          <div className="space-y-3">
            {GUIDE_STEPS.map((s, i) => (
              <LuxReveal key={s.title} delay={i * 0.04}>
                <div className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#C9A84C] to-[#e8c86a] text-black font-bold text-sm">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-semibold">{s.title}</p>
                    <p className="text-white/55 text-sm mt-1 leading-relaxed">{s.body}</p>
                  </div>
                </div>
              </LuxReveal>
            ))}
          </div>
          <LuxReveal className="mt-8">
            <h3 className="font-semibold text-lg mb-3 text-center">Something off? Quick fixes</h3>
            <div className="space-y-3">
              {GUIDE_FIXES.map((f) => (
                <div key={f.q} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <p className="font-semibold mb-1.5 text-sm">{f.q}</p>
                  <p className="text-white/55 text-sm leading-relaxed">{f.a}</p>
                </div>
              ))}
            </div>
          </LuxReveal>
        </div>
      </section>

      {/* Tabs */}
      <section className="px-5 py-16 md:py-20">
        <div className="max-w-6xl mx-auto">
          <LuxReveal className="text-center mb-10">
            <MarketingBadge variant="kicker">Inside the popup</MarketingBadge>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mt-4">
              Five tabs. <span className="text-[#e8c86a]">Everything you need.</span>
            </h2>
          </LuxReveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {TABS.map((t, i) => (
              <LuxReveal key={t.name} delay={i * 0.06}>
                <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-3 hover:border-[#C9A84C]/40 transition">
                  <t.icon className="h-7 w-7 text-[#e8c86a]" />
                  <h3 className="font-semibold text-lg">💬 {t.name}</h3>
                  <p className="text-white/55 text-sm leading-relaxed">{t.body}</p>
                </div>
              </LuxReveal>
            ))}
            <LuxReveal delay={0.3}>
              <div className="h-full rounded-2xl border border-[#C9A84C]/40 bg-gradient-to-br from-[#C9A84C]/15 to-transparent p-6 space-y-3">
                <Zap className="h-7 w-7 text-[#e8c86a]" />
                <h3 className="font-semibold text-lg">⌨️ Omnibox + shortcut</h3>
                <p className="text-white/55 text-sm leading-relaxed">Type <span className="text-white font-mono">bdv</span> + Tab in the address bar to ask Thy Cheat Code anything, or hit Ctrl+Shift+B anywhere.</p>
              </div>
            </LuxReveal>
          </div>
        </div>
      </section>

      {/* Perks */}
      <section className="px-5 py-16 md:py-20 border-t border-white/5">
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-4">
          {PERKS.map((p, i) => (
            <LuxReveal key={p.title} delay={i * 0.06}>
              <div className="text-center space-y-3 p-6">
                <p.icon className="h-8 w-8 text-[#e8c86a] mx-auto" />
                <h3 className="font-semibold">{p.title}</h3>
                <p className="text-white/55 text-sm">{p.body}</p>
              </div>
            </LuxReveal>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="px-5 py-16 md:py-20 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <LuxReveal className="text-center mb-10">
            <MarketingBadge variant="kicker">Questions</MarketingBadge>
            <h2 className="text-3xl font-semibold tracking-tight mt-4">Before you ask</h2>
          </LuxReveal>
          <div className="space-y-3">
            {FAQS.map((f, i) => (
              <LuxReveal key={f.q} delay={i * 0.05}>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <p className="font-semibold mb-1.5">{f.q}</p>
                  <p className="text-white/55 text-sm leading-relaxed">{f.a}</p>
                </div>
              </LuxReveal>
            ))}
          </div>
          <div className="text-center mt-10">
            <Link href="/">
              <span className="text-[#e8c86a] hover:underline text-sm cursor-pointer">← Back to the site</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
