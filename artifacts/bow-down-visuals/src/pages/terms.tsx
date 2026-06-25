import { Link } from "wouter";

function PolicyNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/90 backdrop-blur-xl">
      <div className="max-w-4xl mx-auto px-5 h-14 flex items-center justify-between">
        <Link href="/" className="cursor-pointer">
          <img src={`${import.meta.env.BASE_URL}logo-static.png`} alt="Bow Down Visuals" className="h-10 w-auto" />
        </Link>
        <Link href="/contact" className="text-xs text-white/40 hover:text-primary transition-colors">Contact / Support</Link>
      </div>
    </header>
  );
}

export default function Terms() {
  return (
    <div className="min-h-screen bg-background">
      <PolicyNav />
      <main className="max-w-4xl mx-auto px-5 py-16">
        <h1 className="text-3xl font-black text-white mb-2">Terms of Service</h1>
        <p className="text-white/30 text-sm mb-10">Last updated: June 2026</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-8 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-white font-bold text-lg mb-3">1. About Bow Down Visuals</h2>
            <p>
              Bow Down Visuals ("we," "us," or "our") is a digital creator platform that sells
              AI-powered creator credits. Credits are used to generate digital outputs including
              song lyrics, music video treatment plans, video prompts, caption sets, thumbnails,
              promo clip scripts, and related digital creator tools. All products delivered are
              digital in nature and are not physical goods.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">2. Acceptance of Terms</h2>
            <p>
              By accessing or using Bow Down Visuals, you agree to be bound by these Terms of
              Service. If you do not agree, do not use the platform.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">3. Eligibility</h2>
            <p>
              You must be at least 18 years old to use this service. By using Bow Down Visuals
              you represent that you meet this requirement.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">4. Credits & Digital Products</h2>
            <p>
              Credits are a pre-purchased unit of access to our AI generation tools. Each tool
              consumes a defined number of credits per use. Credits have no cash value and are
              non-transferable. Unused credits expire in accordance with your subscription plan.
              All generated content is digital — no physical product is shipped.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">5. Subscriptions & Billing</h2>
            <p>
              Subscription plans are billed monthly. You may cancel at any time; cancellation
              takes effect at the end of the current billing period. We reserve the right to
              change pricing with 30 days' notice.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">6. Use of Generated Content</h2>
            <p>
              You retain ownership of content you create using our tools, subject to any
              third-party AI model terms. You may not use generated content to harass, defame,
              or produce illegal material. We are not liable for how you use generated output.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">7. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Reverse-engineer or scrape the platform</li>
              <li>Share account access with others</li>
              <li>Use the service to generate spam, hate speech, or illegal content</li>
              <li>Attempt to manipulate credits or billing</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">8. Disclaimers</h2>
            <p>
              Bow Down Visuals is provided "as is." We make no guarantees about the quality,
              accuracy, or fitness for purpose of AI-generated content. Results vary based on
              inputs and AI model behavior.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">9. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, Bow Down Visuals shall not be liable for
              any indirect, incidental, special, or consequential damages arising from your use
              of the platform.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">10. Changes to Terms</h2>
            <p>
              We may update these Terms at any time. Continued use of the platform after
              changes constitutes acceptance of the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">11. Contact</h2>
            <p>
              Questions about these Terms? Email us at{" "}
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
