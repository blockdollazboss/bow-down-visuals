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

export default function RefundPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <PolicyNav />
      <main className="max-w-4xl mx-auto px-5 py-16">
        <h1 className="text-3xl font-black text-white mb-2">Refund Policy</h1>
        <p className="text-white/30 text-sm mb-10">Last updated: June 2026</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-8 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-white font-bold text-lg mb-3">What We Sell</h2>
            <p>
              Bow Down Visuals sells <strong className="text-white/90">digital AI creator credits</strong> — 
              pre-purchased units used to generate lyrics, music video treatment plans, video prompts, 
              caption sets, thumbnails, promo clip scripts, and other digital creator content. 
              All products are digital and delivered instantly upon credit use. No physical goods are sold or shipped.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">Digital Products — General Policy</h2>
            <p>
              Because our products are digital and consumed immediately upon generation, 
              <strong className="text-white/90"> all sales are generally final</strong>. 
              Once credits have been used to generate content, those credits cannot be refunded.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">When We Do Issue Refunds</h2>
            <p>We will issue a full or partial refund in the following situations:</p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>
                <strong className="text-white/90">Technical failure:</strong> Credits were deducted
                but no content was generated due to a platform error on our end.
              </li>
              <li>
                <strong className="text-white/90">Duplicate charge:</strong> You were charged more
                than once for the same subscription period or purchase.
              </li>
              <li>
                <strong className="text-white/90">Unauthorized charge:</strong> You believe your
                account was accessed without your authorization.
              </li>
              <li>
                <strong className="text-white/90">Within 48 hours of first subscription:</strong> If
                you subscribed and have not yet used any credits, you may request a full refund
                within 48 hours of your first payment.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">Subscription Cancellations</h2>
            <p>
              You may cancel your subscription at any time. Cancellation stops future billing;
              you retain access to your remaining credits and subscription benefits through the
              end of the current billing period. <strong className="text-white/90">Partial-month
              refunds are not issued for cancellations mid-cycle.</strong>
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">How to Request a Refund</h2>
            <p>To request a refund, contact us within <strong className="text-white/90">7 days</strong> of the charge:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>
                Email:{" "}
                <a href="mailto:support@bowdownvisuals.com" className="text-primary hover:underline">
                  support@bowdownvisuals.com
                </a>
              </li>
              <li>Subject: <em>Refund Request — [your email]</em></li>
              <li>Include: date of charge, amount, and a brief description of the issue</li>
            </ul>
            <p className="mt-3">
              We aim to respond within 2 business days. Approved refunds are returned to your
              original payment method within 5–10 business days depending on your bank.
            </p>
          </section>

          <section>
            <h2 className="text-white font-bold text-lg mb-3">Questions?</h2>
            <p>
              Visit our{" "}
              <Link href="/contact" className="text-primary hover:underline">Contact / Support page</Link>{" "}
              or email{" "}
              <a href="mailto:support@bowdownvisuals.com" className="text-primary hover:underline">
                support@bowdownvisuals.com
              </a>.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
