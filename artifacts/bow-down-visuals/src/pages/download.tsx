import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingBadge } from "@/components/MarketingBadge";
import { LuxReveal } from "@/components/LuxReveal";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { markExtensionDownloaded } from "@/lib/extension-promo";
import { markAndroidDownloaded, isAndroidDevice } from "@/lib/android-promo";
import {
  Smartphone, Puzzle, Download as DownloadIcon, Check, ShieldCheck,
  Zap, BellRing, MessageCircle,
} from "lucide-react";

/* ─── Unified download page: Android app + Chrome extension ─── */

const APK_STEPS = [
  { title: "Download the APK", body: "Hit the gold Download button. It's the full Bow Down Visuals studio, packaged for Android." },
  { title: "Allow unknown apps", body: "When prompted, allow your browser to install unknown apps. This is standard for sideloading — the APK is signed by us." },
  { title: "Tap to install", body: "Open the downloaded file and tap Install. The Bow Down Visuals icon appears on your home screen." },
  { title: "Sign in", body: "Open the app and sign in with your Bow Down Visuals account — your credits, bonuses and projects carry over." },
];

const EXT_STEPS = [
  { title: "Download the zip", body: "Hit the Download button for the extension. It's a tiny file (under 100KB)." },
  { title: "Unzip it", body: "Extract the zip — you'll get a folder called bow-down-visuals-extension-v2." },
  { title: "Open chrome://extensions", body: "Type chrome://extensions in your address bar and hit Enter." },
  { title: "Turn on Developer mode", body: "Top-right corner toggle, then click “Load unpacked” and select the unzipped folder." },
  { title: "Pin it", body: "Click the puzzle-piece icon in Chrome's toolbar and pin Thy Cheat Code." },
];

const FAQS = [
  { q: "Is the Android app free?", a: "Yes — the app itself is free. AI features inside use your site's Visual Bucs at the same rates as the website." },
  { q: "Is sideloading safe?", a: "The APK is built by us from the same code as the website and signed with our key. You can verify the signature matches future updates." },
  { q: "Do I need an account?", a: "Yes — both the app and the extension sign in with your Bow Down Visuals account, so everything carries over." },
  { q: "Will it be on the Play Store?", a: "Eventually. Sideloading gets it in your hands today without waiting on store review." },
];

export default function Download() {
  usePageTitle("Download — Android App & Chrome Extension | Bow Down Visuals");
  const onAndroid = typeof navigator !== "undefined" && isAndroidDevice();

  return (
    <div className="min-h-screen bg-black text-white">
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Download — Android App & Chrome Extension",
        url: "https://bowdownvisuals.com/download",
      }} />
      <div className="mx-auto max-w-4xl px-6 py-16">
        <LuxReveal>
          <div className="text-center mb-12">
            <MarketingBadge variant="kicker">Get Bow Down Visuals everywhere</MarketingBadge>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              Take the studio <span className="text-[#e8c86a]">with you</span>
            </h1>
            <p className="mt-4 text-white/50 max-w-xl mx-auto">
              The full AI content studio as an Android app, plus Thy Cheat Code
              for your desktop browser. Free to download — your account, credits
              and bonuses carry over everywhere.
            </p>
          </div>
        </LuxReveal>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Android app card */}
          <LuxReveal>
            <div className={`rounded-2xl border p-8 ${onAndroid ? "border-[#e8c86a]/60 shadow-[0_0_40px_rgba(201,168,76,0.25)]" : "border-white/10"} bg-white/[0.03]`}>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#c9a84c]/40 bg-[#c9a84c]/10 mb-6">
                <Smartphone className="h-7 w-7 text-[#e8c86a]" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Android App</h2>
              <p className="text-sm text-white/50 mb-6">
                Every studio tool — songs, videos, thumbnails, promo clips —
                in a native-feel app on your phone.
              </p>
              <ul className="space-y-2 mb-8 text-sm text-white/70">
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-[#e8c86a]" /> Full studio, optimized for touch</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-[#e8c86a]" /> Daily bonus + hourly crate on the go</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-[#e8c86a]" /> Same account, same credits</li>
              </ul>
              <a href="/bow-down-visuals.apk" download onClick={markAndroidDownloaded}>
                <Button className="w-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 text-base py-6">
                  <DownloadIcon className="h-5 w-5 mr-2" /> Download APK
                </Button>
              </a>
              {onAndroid && (
                <p className="mt-3 text-center text-xs text-[#e8c86a]">← You're on Android — this one's for you</p>
              )}
            </div>
          </LuxReveal>

          {/* Extension card */}
          <LuxReveal>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#c9a84c]/40 bg-[#c9a84c]/10 mb-6">
                <Puzzle className="h-7 w-7 text-[#e8c86a]" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Chrome Extension</h2>
              <p className="text-sm text-white/50 mb-6">
                Thy Cheat Code in your browser toolbar — AI chat, every site
                tool, and bonus claims without leaving the page.
              </p>
              <ul className="space-y-2 mb-8 text-sm text-white/70">
                <li className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-[#e8c86a]" /> AI chat on any page</li>
                <li className="flex items-center gap-2"><Zap className="h-4 w-4 text-[#e8c86a]" /> Right-click AI actions</li>
                <li className="flex items-center gap-2"><BellRing className="h-4 w-4 text-[#e8c86a]" /> Never miss free credits</li>
              </ul>
              <a href="/bow-down-visuals-extension-v2.zip" download onClick={markExtensionDownloaded}>
                <Button variant="outline" className="w-full border-white/15 text-base py-6 hover:bg-white/5">
                  <DownloadIcon className="h-5 w-5 mr-2" /> Download Extension
                </Button>
              </a>
              <Link href="/extension" className="mt-3 block text-center text-xs text-white/40 hover:text-white/70">
                Learn more about the extension →
              </Link>
            </div>
          </LuxReveal>
        </div>

        {/* Install guides */}
        <div className="mt-16 grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold mb-4">
              <ShieldCheck className="h-5 w-5 text-[#e8c86a]" /> Installing the APK
            </h3>
            <ol className="space-y-4">
              {APK_STEPS.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#c9a84c]/15 text-xs font-bold text-[#e8c86a]">{i + 1}</span>
                  <div>
                    <p className="text-sm font-semibold">{s.title}</p>
                    <p className="text-xs text-white/45 mt-0.5">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold mb-4">
              <ShieldCheck className="h-5 w-5 text-[#e8c86a]" /> Installing the extension
            </h3>
            <ol className="space-y-4">
              {EXT_STEPS.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#c9a84c]/15 text-xs font-bold text-[#e8c86a]">{i + 1}</span>
                  <div>
                    <p className="text-sm font-semibold">{s.title}</p>
                    <p className="text-xs text-white/45 mt-0.5">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* FAQs */}
        <div className="mt-16">
          <h3 className="text-lg font-bold mb-6 text-center">Questions</h3>
          <div className="space-y-3 max-w-2xl mx-auto">
            {FAQS.map((f, i) => (
              <div key={i} className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
                <p className="text-sm font-semibold mb-1">{f.q}</p>
                <p className="text-xs text-white/45">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
