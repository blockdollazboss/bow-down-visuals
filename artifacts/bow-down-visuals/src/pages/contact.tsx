import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Mail, CheckCircle2, Send } from "lucide-react";

const NAV_LINKS = [
  { label: "Home",     href: "/" },
  { label: "Pricing",  href: "/pricing" },
  { label: "Waitlist", href: "/waitlist" },
];

function NavBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/90 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="cursor-pointer shrink-0">
          <img
            src={`${import.meta.env.BASE_URL}logo-static.png`}
            alt="Bow Down Visuals"
            className="h-10 w-auto"
            style={{ filter: "drop-shadow(0 0 1.5px rgba(255,255,255,0.5))" }}
          />
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-white/45 hover:text-white hover:bg-white/[0.04] transition-colors">{l.label}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-2.5">
          <Link href="/login" className="hidden md:inline-flex items-center px-4 py-1.5 rounded-full text-sm font-semibold bg-primary/10 border border-primary/25 text-primary hover:bg-primary/20 transition-colors">
            Sign In
          </Link>
          <button
            className="flex md:hidden items-center justify-center h-8 w-8 rounded-lg text-white/60 hover:text-white transition-colors"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            ) : (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/></svg>
            )}
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="md:hidden border-t border-white/[0.06] bg-black/95 backdrop-blur-xl px-5 py-4 space-y-1">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setMenuOpen(false)} className="flex items-center px-3 py-2.5 rounded-xl text-sm font-medium text-white/50 hover:text-white hover:bg-white/[0.04] transition-colors">{l.label}</Link>
          ))}
        </div>
      )}
    </header>
  );
}

export default function Contact() {
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent]       = useState(false);
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSent(true);
    }, 900);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <NavBar />

      <main className="flex-1 flex flex-col items-center justify-center px-5 py-20">
        <div className="w-full max-w-lg">

          {/* Header */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 mb-5">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">Get in Touch</h1>
            <p className="text-white/40 text-sm leading-relaxed">
              Questions, feedback, or partnership inquiries — we respond to every message.
            </p>
            <a
              href="mailto:support@bowdownvisuals.com"
              className="inline-block mt-3 text-xs text-primary/70 hover:text-primary transition-colors"
            >
              support@bowdownvisuals.com
            </a>
          </div>

          {/* Card */}
          <div className="rounded-2xl border border-white/[0.08] bg-card p-8 gold-glow-sm">
            {sent ? (
              <div className="flex flex-col items-center justify-center py-8 gap-4 text-center">
                <CheckCircle2 className="h-12 w-12 text-primary" />
                <h2 className="text-xl font-bold text-white">Message Sent!</h2>
                <p className="text-white/45 text-sm max-w-xs leading-relaxed">
                  Thanks for reaching out. We'll get back to you at <span className="text-white/70">{email}</span> shortly.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 border-white/10 text-white/50 hover:text-white"
                  onClick={() => { setSent(false); setName(""); setEmail(""); setMessage(""); }}
                >
                  Send Another
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-white/60 text-xs font-semibold uppercase tracking-wider">Name</Label>
                  <Input
                    id="name"
                    placeholder="Your name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="bg-background border-white/[0.1] text-white placeholder:text-white/25 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-white/60 text-xs font-semibold uppercase tracking-wider">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-background border-white/[0.1] text-white placeholder:text-white/25 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="message" className="text-white/60 text-xs font-semibold uppercase tracking-wider">Message</Label>
                  <Textarea
                    id="message"
                    placeholder="Tell us what's on your mind..."
                    required
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="bg-background border-white/[0.1] text-white placeholder:text-white/25 focus-visible:ring-primary/40 focus-visible:border-primary/50 resize-none"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-primary hover:bg-primary/90 text-black font-bold h-11 gap-2"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                      Sending…
                    </span>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Send Message
                    </>
                  )}
                </Button>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
