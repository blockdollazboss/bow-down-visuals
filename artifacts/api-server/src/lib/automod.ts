/** automod.ts — live-chat automod evaluation (Stack 10 #4). Pure:
 *  a message + the creator's configured rules → allow or flag with the
 *  exact rule that fired. No silent shadow actions: every flag carries
 *  a human-readable reason the affected chatter can see. */
export interface AutomodRules {
  blockLinks: boolean;
  blockedWords: string[];
  capsPercent: number | null;
  capsMinLength: number;
}
export interface AutomodVerdict { action: "allow" | "flag"; rule: string | null; reason: string | null }

const LINK_RE = /(https?:\/\/|www\.)\S+/i;

export function evaluateAutomod(body: string, rules: AutomodRules): AutomodVerdict {
  if (rules.blockLinks && LINK_RE.test(body)) {
    return { action: "flag", rule: "block_links", reason: "Links are turned off in this chat by the creator." };
  }
  const lower = body.toLowerCase();
  for (const w of rules.blockedWords) {
    const word = w.trim().toLowerCase();
    if (word && lower.includes(word)) {
      return { action: "flag", rule: "blocked_word", reason: "That message included a word the creator has blocked in this chat." };
    }
  }
  if (rules.capsPercent != null && body.length >= Math.max(1, rules.capsMinLength)) {
    const letters = body.replace(/[^A-Za-z]/g, "");
    if (letters.length >= 8) {
      const caps = letters.replace(/[^A-Z]/g, "").length;
      if ((caps / letters.length) * 100 > rules.capsPercent) {
        return { action: "flag", rule: "caps_limit", reason: "That message was mostly capital letters, which this chat limits." };
      }
    }
  }
  return { action: "allow", rule: null, reason: null };
}
