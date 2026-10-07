import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingBadge } from "@/components/MarketingBadge";
import { LuxReveal } from "@/components/LuxReveal";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { markExtensionDownloaded } from "@/lib/extension-promo";
import { markAndroidDownloaded, isAndroidDevice } from "@/lib/android-promo";
import { markIOSInstalled, isIOSDevice } from "@/lib/ios-promo";
import {
  Smartphone, Puzzle, Download as DownloadIcon, Check, ShieldCheck,
  Zap, BellRing, MessageCircle, Share,
} from "lucide-react";
import { useTranslation } from "react-i18next";

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

const IOS_STEPS = [
  { title: "Open in Safari", body: "Visit bowdownvisuals.com in Safari on your iPhone or iPad (it must be Safari, not Chrome)." },
  { title: "Tap the Share button", body: "Tap the Share icon at the bottom of the screen (the square with an arrow pointing up)." },
  { title: "Add to Home Screen", body: "Scroll down in the share sheet and tap “Add to Home Screen”, then tap Add." },
  { title: "Open from your home screen", body: "The Bow Down Visuals icon appears alongside your apps — tap it to launch the full studio, full-screen." },
  { title: "Sign in", body: "Sign in with your Bow Down Visuals account — your credits, bonuses and projects carry over." },
];

const FAQS = [
  { q: "Is the Android app free?", a: "Yes — the app itself is free. AI features inside use your site's Visual Bucs at the same rates as the website." },
  { q: "Is sideloading safe?", a: "The APK is built by us from the same code as the website and signed with our key. You can verify the signature matches future updates." },
  { q: "Do I need an account?", a: "Yes — both the app and the extension sign in with your Bow Down Visuals account, so everything carries over." },
  { q: "Will it be on the Play Store?", a: "Eventually. Sideloading gets it in your hands today without waiting on store review." },
  { q: "What about iPhone?", a: "No App Store download needed — open bowdownvisuals.com in Safari, tap Share → Add to Home Screen, and the full studio installs as a web app on your home screen." },
];

export default function Download() {
  const { t } = useTranslation();
  usePageTitle(t("download.metaTitle"));
  const onAndroid = typeof navigator !== "undefined" && isAndroidDevice();
  const onIOS = typeof navigator !== "undefined" && isIOSDevice();

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
            <MarketingBadge variant="kicker">{t("download.get_bow_down_visuals_everywhere")}</MarketingBadge>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">{t("download.take_the_studio")}<span className="text-[#e8c86a]">{t("download.with_you")}</span>
            </h1>
            <p className="mt-4 text-white/50 max-w-xl mx-auto">{t("download.the_full_ai_content_studio_as_an")}</p>
          </div>
        </LuxReveal>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Android app card */}
          <LuxReveal>
            <div className={`rounded-2xl border p-8 ${onAndroid ? "border-[#e8c86a]/60 shadow-[0_0_40px_rgba(201,168,76,0.25)]" : "border-white/10"} bg-white/[0.03]`}>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#c9a84c]/40 bg-[#c9a84c]/10 mb-6">
                <Smartphone className="h-7 w-7 text-[#e8c86a]" />
              </div>
              <h2 className="text-2xl font-bold mb-2">{t("download.android_app")}</h2>
              <p className="text-sm text-white/50 mb-6">{t("download.every_studio_tool_songs_videos_t")}</p>
              <ul className="space-y-2 mb-8 text-sm text-white/70">
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-[#e8c86a]" />{t("download.full_studio_optimized_for_touch")}</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-[#e8c86a]" />{t("download.daily_bonus_hourly_crate_on_the")}</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-[#e8c86a]" />{t("download.same_account_same_credits")}</li>
              </ul>
              <a href="https://github.com/blockdollazboss/bow-down-visuals/releases/download/v1.0.1-android/bow-down-visuals.apk" download onClick={markAndroidDownloaded}>
                <Button className="w-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 text-base py-6">
                  <DownloadIcon className="h-5 w-5 mr-2" />{t("download.download_apk")}</Button>
              </a>
              {onAndroid && (
                <p className="mt-3 text-center text-xs text-[#e8c86a]">{t("download.you_re_on_android_this_one_s_for")}</p>
              )}
            </div>
          </LuxReveal>

          {/* Extension card */}
          <LuxReveal>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#c9a84c]/40 bg-[#c9a84c]/10 mb-6">
                <Puzzle className="h-7 w-7 text-[#e8c86a]" />
              </div>
              <h2 className="text-2xl font-bold mb-2">{t("download.chrome_extension")}</h2>
              <p className="text-sm text-white/50 mb-6">{t("download.thy_cheat_code_in_your_browser_t")}</p>
              <ul className="space-y-2 mb-8 text-sm text-white/70">
                <li className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-[#e8c86a]" />{t("download.ai_chat_on_any_page")}</li>
                <li className="flex items-center gap-2"><Zap className="h-4 w-4 text-[#e8c86a]" />{t("download.right_click_ai_actions")}</li>
                <li className="flex items-center gap-2"><BellRing className="h-4 w-4 text-[#e8c86a]" />{t("download.never_miss_free_credits")}</li>
              </ul>
              <a href="/bow-down-visuals-extension-v2.zip" download onClick={markExtensionDownloaded}>
                <Button variant="outline" className="w-full border-white/15 text-base py-6 hover:bg-white/5">
                  <DownloadIcon className="h-5 w-5 mr-2" />{t("download.download_extension")}</Button>
              </a>
              <Link href="/extension" className="mt-3 block text-center text-xs text-white/40 hover:text-white/70">{t("download.learn_more_about_the_extension")}</Link>
            </div>
          </LuxReveal>

          {/* iPhone / iPad card */}
          <LuxReveal>
            <div className={`rounded-2xl border p-8 ${onIOS ? "border-[#e8c86a]/60 shadow-[0_0_40px_rgba(201,168,76,0.25)]" : "border-white/10"} bg-white/[0.03]`}>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#c9a84c]/40 bg-[#c9a84c]/10 mb-6">
                <Share className="h-7 w-7 text-[#e8c86a]" />
              </div>
              <h2 className="text-2xl font-bold mb-2">iPhone & iPad</h2>
              <p className="text-sm text-white/50 mb-6">Install the full studio as a web app — no App Store needed.</p>
              <ul className="space-y-2 mb-8 text-sm text-white/70">
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-[#e8c86a]" />Full studio, full-screen from your home screen</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-[#e8c86a]" />Daily bonus & hourly crate on the go</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-[#e8c86a]" />Same account, same credits</li>
              </ul>
              <Button
                className="w-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 text-base py-6"
                onClick={() => {
                  markIOSInstalled();
                  document.getElementById("ios-install-steps")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <Share className="h-5 w-5 mr-2" />Show me how
              </Button>
              {onIOS && (
                <p className="mt-3 text-center text-xs text-[#e8c86a]">You're on iOS — this one's for you.</p>
              )}
            </div>
          </LuxReveal>
        </div>

        {/* Install guides */}
        <div id="ios-install-steps" className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold mb-4">
              <ShieldCheck className="h-5 w-5 text-[#e8c86a]" />{t("download.installing_the_apk")}</h3>
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
              <ShieldCheck className="h-5 w-5 text-[#e8c86a]" />{t("download.installing_the_extension")}</h3>
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
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold mb-4">
              <Share className="h-5 w-5 text-[#e8c86a]" />Installing on iPhone / iPad</h3>
            <ol className="space-y-4">
              {IOS_STEPS.map((s, i) => (
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
          <h3 className="text-lg font-bold mb-6 text-center">{t("download.questions")}</h3>
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
