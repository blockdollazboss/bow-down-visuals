import { Link } from "wouter";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";

function PolicyNav() {
  /* Same cursor-tilt + gold-glow treatment as the header brand mark. */
  const logoTilt = useTiltOnHover<HTMLAnchorElement>({ maxDeg: 8, maxShift: 6 });

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/90 backdrop-blur-xl">
      <div className="max-w-4xl mx-auto px-5 h-14 flex items-center justify-between">
        <Link href="/" ref={logoTilt} className="cursor-pointer inline-block rounded-lg">
          <img src={`${import.meta.env.BASE_URL}logo-static.png`} alt="Bow Down Visuals" className="h-10 w-auto" />
        </Link>
        <Link href="/contact" className="text-xs text-white/40 hover:text-primary transition-colors">Contact / Support</Link>
      </div>
    </header>
  );
}

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <PolicyNav />
      <main className="max-w-4xl mx-auto px-5 py-16">
        <h1 className="text-3xl font-black text-white mb-2">Privacy Policy</h1>
        <p className="text-white/30 text-sm mb-10">Last updated: June 2026</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-8 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-white font-bold text-lg mb-3">1. Who We Are</h2>
            <p>
              Bow Down Visuals operates a digital creator platform that provides AI-powered
              credits for generating lyrics, music video plans, video prompts, captions,
              thumbnails, promo clips, and related digital content. This policy explains how
              we collect, use, and protect your information.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">2. Information We Collect</h2>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong className="text-white/90">Account info:</strong> email address and password (hashed) when you register</li>
              <li><strong className="text-white/90">Billing info:</strong> handled entirely by Stripe — we never store raw card data</li>
              <li><strong className="text-white/90">Usage data:</strong> credit usage, tool interactions, and generated content prompts</li>
              <li><strong className="text-white/90">Artist profile data:</strong> info you enter to personalize AI outputs (artist name, genre, style preferences)</li>
              <li><strong className="text-white/90">Technical data:</strong> browser type, IP address, and session data for security and performance</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>To operate and improve the platform</li>
              <li>To process payments and manage subscriptions</li>
              <li>To personalize AI-generated outputs to your artist profile</li>
              <li>To send account-related emails (receipts, security alerts)</li>
              <li>To comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">4. Data Sharing</h2>
            <p>We do not sell your personal data. We share data only with:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong className="text-white/90">Stripe</strong> — payment processing</li>
              <li><strong className="text-white/90">Supabase</strong> — database and authentication</li>
              <li><strong className="text-white/90">AI providers</strong> — to fulfill generation requests (prompts may be processed by third-party AI APIs)</li>
              <li>Law enforcement when required by applicable law</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">5. Cookies & Tracking</h2>
            <p>
              We use session cookies necessary for authentication. We do not run third-party
              ad trackers. Analytics, if used, are limited to aggregate usage data.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">6. Data Retention</h2>
            <p>
              We retain your account data for as long as your account is active. You may
              request deletion at any time by contacting us. Billing records are retained
              as required by law.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">7. Your Rights</h2>
            <p>
              Depending on your location, you may have the right to access, correct, or delete
              your personal data. To exercise any of these rights, contact us at{" "}
              <a href="mailto:support@bowdownvisuals.com" className="text-primary hover:underline">
                support@bowdownvisuals.com
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">8. Security</h2>
            <p>
              We use industry-standard security measures including encrypted connections (HTTPS),
              hashed passwords, and row-level security on our database. No system is 100% secure;
              use a strong unique password for your account.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">9. Changes to This Policy</h2>
            <p>
              We may update this policy from time to time. We'll notify you of material changes
              via email or an in-app notice.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">10. Contact</h2>
            <p>
              Privacy questions? Email{" "}
              <a href="mailto:support@bowdownvisuals.com" className="text-primary hover:underline">
                support@bowdownvisuals.com
              </a>{" "}
              or visit our <Link href="/contact" className="text-primary hover:underline">Contact page</Link>.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
