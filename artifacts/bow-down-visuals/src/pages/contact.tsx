import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Mail, CheckCircle2, Send } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";

export default function Contact() {
  const { t } = useTranslation();
  usePageTitle(t("contact.metaTitle"), t("contact.metaDescription"));
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), message: message.trim() }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.message ?? data.error ?? t("contact.genericError"));
        setLoading(false);
        return;
      }
      setSent(true);
    } catch {
      setError(t("contact.connectionError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">

      <main className="flex-1 flex flex-col items-center justify-center px-5 py-20">
        <div className="w-full max-w-lg">

          {/* Header */}
          <div className="text-center mb-10">
            <img
              src={`${import.meta.env.BASE_URL}images/shark-king-clean-authority.png`}
              alt="Thy Cheat Code"
              className="h-28 w-28 rounded-3xl object-cover mx-auto mb-5 border-2 border-primary/30 shadow-[0_0_40px_rgba(201,168,76,0.25)]"
            />
            <h1 className="text-3xl font-bold text-white mb-2">{t("contact.get_in_touch")}</h1>
            <p className="text-white/40 text-sm leading-relaxed">{t("contact.questions_feedback_or_partnershi")}</p>
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
                <h2 className="text-xl font-bold text-white">{t("contact.message_sent")}</h2>
                <p className="text-white/45 text-sm max-w-xs leading-relaxed">
                  {t("contact.thanksMessage", { email })}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 border-white/10 text-white/50 hover:text-white"
                  onClick={() => { setSent(false); setName(""); setEmail(""); setMessage(""); }}
                >{t("contact.send_another")}</Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-white/60 text-xs font-semibold uppercase tracking-wider">{t("contact.name")}</Label>
                  <Input
                    id="name"
                    placeholder={t("contact.your_name")}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="bg-background border-white/[0.1] text-white placeholder:text-white/25 focus-visible:ring-primary/40 focus-visible:border-primary/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-white/60 text-xs font-semibold uppercase tracking-wider">{t("contact.email")}</Label>
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
                  <Label htmlFor="message" className="text-white/60 text-xs font-semibold uppercase tracking-wider">{t("contact.message")}</Label>
                  <Textarea
                    id="message"
                    placeholder={t("contact.tell_us_what_s_on_your_mind")}
                    required
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="bg-background border-white/[0.1] text-white placeholder:text-white/25 focus-visible:ring-primary/40 focus-visible:border-primary/50 resize-none"
                  />
                </div>

                {error && (
                  <div className="p-3 rounded-xl border border-red-500/20 bg-red-500/5">
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-primary hover:bg-primary/90 text-black font-bold h-11 gap-2"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>{t("contact.sending")}</span>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />{t("contact.send_message")}</>
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
