import { Button } from "@/components/ui/button";
import { MarketingBadge } from "@/components/MarketingBadge";
import { LuxReveal } from "@/components/LuxReveal";
import { ThemedLogo } from "@/components/ThemedLogo";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { APP_DOWNLOADS, formatDownloadSize } from "@/lib/app-downloads";
import { markExtensionDownloaded } from "@/lib/extension-promo";
import { markAndroidDownloaded, isAndroidDevice } from "@/lib/android-promo";
import { markIOSInstalled, isIOSDevice } from "@/lib/ios-promo";
import {
  Smartphone, Puzzle, Download as DownloadIcon, Check, ShieldCheck,
  Share, Monitor, RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";

/* ─── Get the App — the app's public home (Stack-100 #3, lane app-page).
   One page a visitor can land on and leave with the app installed:
   the Android APK and the Chrome extension download straight from
   here; iPhone/iPad and Windows/Mac install the web app with real
   steps. Every version/size/checksum comes from lib/app-downloads —
   the artifacts' own metadata — never from copy. Modeled on how the
   reference app page operates (one page that IS the app's home) and
   styled with the same premium system as pages/download.tsx, which
   stays as the members' download desk. ─── */

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

const DESKTOP_STEPS = [
  { title: "Open in Chrome or Edge", body: "Visit bowdownvisuals.com in Chrome or Edge on Windows, Mac or Linux. On a Mac, Safari works too — see step 3." },
  { title: "Hit Install", body: "Click the install icon at the right end of the address bar. No icon? Open the browser menu and choose the Install option for Thy Cheat Code (in Edge it's under Apps → “Install this site as an app”)." },
  { title: "Safari on Mac", body: "In Safari, choose File → Add to Dock instead — same result: the app lands in your Dock." },
  { title: "Launch it like any app", body: "Bow Down Visuals opens in its own window from your Start menu, Dock or Applications folder — no browser bar, no tabs." },
  { title: "Sign in", body: "Sign in with your Bow Down Visuals account — your credits, bonuses and projects carry over." },
];

const FAQS = [
  { q: "Is the app free?", a: "Yes — the app itself is free on every platform. AI features inside use your site's Visual Bucs at the same rates as the website." },
  { q: "Do I need an account?", a: "Yes — the app, the extension and the web app all sign in with your Bow Down Visuals account, so your credits and projects carry over everywhere." },
  { q: "Is sideloading the APK safe?", a: "The APK is built by us from the same code as the website and signed with our release key. The SHA-256 checksum under the Download button is the file's fingerprint — it matches the digest GitHub reports for the release, so you can verify the download is the real build." },
  { q: "Is there a Windows or Mac download?", a: "No .exe or .dmg — and be wary of anyone offering one. The desktop app installs from your browser instead: open bowdownvisuals.com in Chrome, Edge or Safari and use Install / Add to Dock (steps above). It's the full studio in its own window, and it updates itself." },
  { q: "What about iPhone?", a: "No App Store download needed — open bowdownvisuals.com in Safari, tap Share → Add to Home Screen, and the full studio installs as a web app on your home screen." },
  { q: "Will it be on the Play Store?", a: "Eventually. Sideloading gets it in your hands today without waiting on store review." },
];

function StepsList({ steps }: { steps: { title: string; body: string }[] }) {
  const isLight = useIsLightTheme();
  return (
    <ol className="space-y-4">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#c9a84c]/15 text-xs font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{i + 1}</span>
          <div>
            <p className="text-sm font-semibold">{s.title}</p>
            <p className="text-xs text-white/45 mt-0.5">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function AppPage() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  usePageTitle(
    t("appPage.metaTitle"),
    "Get the Bow Down Visuals app — download the Android APK or the Chrome extension, or install the web app on iPhone, iPad, Windows and Mac.",
  );
  const onAndroid = typeof navigator !== "undefined" && isAndroidDevice();
  const onIOS = typeof navigator !== "undefined" && isIOSDevice();

  const goldBtn = "w-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 text-base py-6";
  const cardHot = "border-[#e8c86a]/60 shadow-[0_0_40px_rgba(201,168,76,0.25)]";
  const cardBase = isLight
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] text-[#2A1E07] shadow-[0_10px_30px_rgba(122,90,18,0.12)]"
    : "border-white/10 bg-gradient-to-b from-[#14100a] to-[#0d0a04]";
  const iconGold = isLight ? "text-[#7A5A12]" : "text-[#e8c86a]";
  const subText = isLight ? "text-[#6B5B36]" : "text-white/50";
  const liText = isLight ? "text-[#4A3B1E]" : "text-white/70";
  const hintText = isLight ? "text-[#7A5A12]" : "text-[#e8c86a]";
  const metaText = isLight ? "text-[#8A7A56]" : "text-white/40";

  const versionSize = (d: typeof APP_DOWNLOADS.android) =>
    t("appPage.versionSize", { version: d.version, size: formatDownloadSize(d.sizeBytes) });

  return (
    <div className="min-h-screen bg-black text-white">
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Get the App — Bow Down Visuals",
        url: "https://bowdownvisuals.com/app",
      }} />
      <div className="mx-auto max-w-4xl px-6 py-16">
        <LuxReveal>
          <div className="text-center mb-12">
            <div className="flex justify-center mb-6">
              <ThemedLogo className="h-20 w-auto" />
            </div>
            <MarketingBadge variant="kicker">{t("appPage.kicker")}</MarketingBadge>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">{t("appPage.headlineA")}{" "}
              <span className={isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}>{t("appPage.headlineB")}</span>
            </h1>
            <p className={`mt-4 max-w-xl mx-auto ${subText}`}>{t("appPage.sub")}</p>
          </div>
        </LuxReveal>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Android app card */}
          <LuxReveal>
            <div className={`rounded-2xl border p-8 ${onAndroid ? cardHot : ""} ${cardBase}`}>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#c9a84c]/40 bg-[#c9a84c]/10 mb-6">
                <Smartphone className={`h-7 w-7 ${iconGold}`} />
              </div>
              <h2 className="text-2xl font-bold mb-2">{t("appPage.androidTitle")}</h2>
              <p className={`text-sm mb-6 ${subText}`}>{t("appPage.androidBody")}</p>
              <ul className={`space-y-2 mb-8 text-sm ${liText}`}>
                <li className="flex items-center gap-2"><Check className={`h-4 w-4 ${iconGold}`} />{t("appPage.androidPoint1")}</li>
                <li className="flex items-center gap-2"><Check className={`h-4 w-4 ${iconGold}`} />{t("appPage.androidPoint2")}</li>
                <li className="flex items-center gap-2"><Check className={`h-4 w-4 ${iconGold}`} />{t("appPage.androidPoint3")}</li>
              </ul>
              <a href={APP_DOWNLOADS.android.url} download onClick={markAndroidDownloaded}>
                <Button className={goldBtn}>
                  <DownloadIcon className="h-5 w-5 mr-2" />{t("appPage.downloadApk")}</Button>
              </a>
              <p className={`mt-3 text-center text-xs ${metaText}`}>{versionSize(APP_DOWNLOADS.android)}</p>
              <p className={`mt-1 text-center text-[11px] break-all ${metaText}`} title={APP_DOWNLOADS.android.sha256}>
                {t("appPage.checksumLabel")}: {APP_DOWNLOADS.android.sha256.slice(0, 16)}…
              </p>
              {onAndroid && (
                <p className={`mt-3 text-center text-xs ${hintText}`}>{t("appPage.androidHint")}</p>
              )}
            </div>
          </LuxReveal>

          {/* Chrome extension card */}
          <LuxReveal>
            <div className={`rounded-2xl border p-8 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] text-[#2A1E07] shadow-[0_10px_30px_rgba(122,90,18,0.12)]" : "border-white/10 bg-white/[0.03]"}`}>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#c9a84c]/40 bg-[#c9a84c]/10 mb-6">
                <Puzzle className={`h-7 w-7 ${iconGold}`} />
              </div>
              <h2 className="text-2xl font-bold mb-2">{t("appPage.extensionTitle")}</h2>
              <p className={`text-sm mb-6 ${subText}`}>{t("appPage.extensionBody")}</p>
              <ul className={`space-y-2 mb-8 text-sm ${liText}`}>
                <li className="flex items-center gap-2"><Check className={`h-4 w-4 ${iconGold}`} />{t("appPage.extensionPoint1")}</li>
                <li className="flex items-center gap-2"><Check className={`h-4 w-4 ${iconGold}`} />{t("appPage.extensionPoint2")}</li>
                <li className="flex items-center gap-2"><Check className={`h-4 w-4 ${iconGold}`} />{t("appPage.extensionPoint3")}</li>
              </ul>
              <a href={APP_DOWNLOADS.extension.url} download onClick={markExtensionDownloaded}>
                <Button variant="outline" className={`w-full text-base py-6 ${isLight ? "border-[#C9A84C]/50 bg-[#C9A84C]/10 text-[#2A1E07] hover:bg-[#C9A84C]/20" : "border-white/15 hover:bg-white/5"}`}>
                  <DownloadIcon className="h-5 w-5 mr-2" />{t("appPage.downloadExtension")}</Button>
              </a>
              <p className={`mt-3 text-center text-xs ${metaText}`}>{versionSize(APP_DOWNLOADS.extension)}</p>
              <p className={`mt-1 text-center text-[11px] break-all ${metaText}`} title={APP_DOWNLOADS.extension.sha256}>
                {t("appPage.checksumLabel")}: {APP_DOWNLOADS.extension.sha256.slice(0, 16)}…
              </p>
              <a href="/extension" className={`mt-3 block text-center text-xs ${isLight ? "text-[#8A7A56] hover:text-[#2A1E07]" : "text-white/40 hover:text-white/70"}`}>{t("appPage.learnMore")}</a>
            </div>
          </LuxReveal>

          {/* iPhone / iPad card */}
          <LuxReveal>
            <div className={`rounded-2xl border p-8 ${onIOS ? cardHot : ""} ${cardBase}`}>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#c9a84c]/40 bg-[#c9a84c]/10 mb-6">
                <Share className={`h-7 w-7 ${iconGold}`} />
              </div>
              <h2 className="text-2xl font-bold mb-2">{t("appPage.iosTitle")}</h2>
              <p className={`text-sm mb-6 ${subText}`}>{t("appPage.iosBody")}</p>
              <ul className={`space-y-2 mb-8 text-sm ${liText}`}>
                <li className="flex items-center gap-2"><Check className={`h-4 w-4 ${iconGold}`} />{t("appPage.iosPoint1")}</li>
                <li className="flex items-center gap-2"><Check className={`h-4 w-4 ${iconGold}`} />{t("appPage.iosPoint2")}</li>
                <li className="flex items-center gap-2"><Check className={`h-4 w-4 ${iconGold}`} />{t("appPage.iosPoint3")}</li>
              </ul>
              <Button
                className={goldBtn}
                onClick={() => {
                  markIOSInstalled();
                  document.getElementById("ios-install-steps")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <Share className="h-5 w-5 mr-2" />{t("appPage.showMeHow")}
              </Button>
              {onIOS && (
                <p className={`mt-3 text-center text-xs ${hintText}`}>{t("appPage.iosHint")}</p>
              )}
            </div>
          </LuxReveal>

          {/* Desktop (Windows & Mac) card */}
          <LuxReveal>
            <div className={`rounded-2xl border p-8 ${cardBase}`}>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#c9a84c]/40 bg-[#c9a84c]/10 mb-6">
                <Monitor className={`h-7 w-7 ${iconGold}`} />
              </div>
              <h2 className="text-2xl font-bold mb-2">{t("appPage.desktopTitle")}</h2>
              <p className={`text-sm mb-6 ${subText}`}>{t("appPage.desktopBody")}</p>
              <ul className={`space-y-2 mb-8 text-sm ${liText}`}>
                <li className="flex items-center gap-2"><Check className={`h-4 w-4 ${iconGold}`} />{t("appPage.desktopPoint1")}</li>
                <li className="flex items-center gap-2"><Check className={`h-4 w-4 ${iconGold}`} />{t("appPage.desktopPoint2")}</li>
                <li className="flex items-center gap-2"><Check className={`h-4 w-4 ${iconGold}`} />{t("appPage.desktopPoint3")}</li>
              </ul>
              <Button
                className={goldBtn}
                onClick={() => {
                  document.getElementById("desktop-install-steps")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <Monitor className="h-5 w-5 mr-2" />{t("appPage.showMeHow")}
              </Button>
            </div>
          </LuxReveal>
        </div>

        {/* Install guides */}
        <h2 className="mt-16 text-xl font-bold text-center">{t("appPage.stepsTitle")}</h2>
        <div className={`mt-6 grid gap-8 md:grid-cols-2 rounded-3xl border p-6 md:p-8 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] text-[#2A1E07]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold mb-4">
              <ShieldCheck className={`h-5 w-5 ${iconGold}`} />{t("appPage.apkStepsTitle")}</h3>
            <StepsList steps={APK_STEPS} />
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold mb-4">
              <ShieldCheck className={`h-5 w-5 ${iconGold}`} />{t("appPage.extStepsTitle")}</h3>
            <StepsList steps={EXT_STEPS} />
          </div>
          <div id="ios-install-steps">
            <h3 className="flex items-center gap-2 text-lg font-bold mb-4">
              <Share className={`h-5 w-5 ${iconGold}`} />{t("appPage.iosStepsTitle")}</h3>
            <StepsList steps={IOS_STEPS} />
          </div>
          <div id="desktop-install-steps">
            <h3 className="flex items-center gap-2 text-lg font-bold mb-4">
              <Monitor className={`h-5 w-5 ${iconGold}`} />{t("appPage.desktopStepsTitle")}</h3>
            <StepsList steps={DESKTOP_STEPS} />
          </div>
        </div>

        {/* How updates work */}
        <div className={`mt-16 rounded-3xl border p-6 md:p-8 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] text-[#2A1E07]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
          <h3 className="flex items-center gap-2 text-lg font-bold mb-6">
            <RefreshCw className={`h-5 w-5 ${iconGold}`} />{t("appPage.updatesTitle")}</h3>
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <p className="text-sm font-semibold mb-1">{t("appPage.updatesAndroidLabel")}</p>
              <p className={`text-xs ${subText}`}>{t("appPage.updatesAndroid")}</p>
            </div>
            <div>
              <p className="text-sm font-semibold mb-1">{t("appPage.updatesExtensionLabel")}</p>
              <p className={`text-xs ${subText}`}>{t("appPage.updatesExtension")}</p>
            </div>
            <div>
              <p className="text-sm font-semibold mb-1">{t("appPage.updatesWebLabel")}</p>
              <p className={`text-xs ${subText}`}>{t("appPage.updatesWeb")}</p>
            </div>
          </div>
        </div>

        {/* FAQs */}
        <div className="mt-16">
          <h3 className="text-lg font-bold mb-6 text-center">{t("appPage.faqTitle")}</h3>
          <div className="space-y-3 max-w-2xl mx-auto">
            {FAQS.map((f, i) => (
              <div key={i} className={`rounded-xl border p-5 ${isLight ? "border-[#C9A84C]/35 bg-[#FBF6E9] text-[#2A1E07]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
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
