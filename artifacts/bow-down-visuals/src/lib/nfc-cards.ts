/* NFC business-card line — shared frontend constants + API helpers. */

export interface NfcCardStyle {
  key: string;
  label: string;
  priceCents: number;
  blurb: string;
  swatch: string; // css gradient for the style picker
}

export const NFC_CARD_STYLES: NfcCardStyle[] = [
  {
    key: "pvc-matte-black",
    label: "Matte Black PVC",
    priceCents: 2900,
    blurb: "Stealth black plastic, gold print — the signature look",
    swatch: "linear-gradient(135deg,#0a0a0a 60%,#d4af37 100%)",
  },
  {
    key: "pvc-white",
    label: "Gloss White PVC",
    priceCents: 2900,
    blurb: "Clean white plastic, full-color print",
    swatch: "linear-gradient(135deg,#ffffff 60%,#e8e8e8 100%)",
  },
  {
    key: "wood-bamboo",
    label: "Bamboo Wood",
    priceCents: 3900,
    blurb: "Real bamboo, laser-etched — natural premium feel",
    swatch: "linear-gradient(135deg,#c8a165 60%,#8a6238 100%)",
  },
  {
    key: "metal-black",
    label: "Black Metal",
    priceCents: 5900,
    blurb: "Heavy black metal, etched — the power move",
    swatch: "linear-gradient(135deg,#1a1a1a 40%,#3a3a3a 60%,#0a0a0a 100%)",
  },
  {
    key: "metal-gold",
    label: "Gold Metal",
    priceCents: 6900,
    blurb: "Gold-finish metal, etched — pure luxury",
    swatch: "linear-gradient(135deg,#d4af37 30%,#f5d76e 50%,#b8860b 100%)",
  },
];

export function nfcStyleByKey(key: string): NfcCardStyle | undefined {
  return NFC_CARD_STYLES.find((s) => s.key === key);
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export interface NfcLink {
  label: string;
  url: string;
}

export interface NfcProfile {
  slug: string;
  display_name: string;
  title?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  links: NfcLink[];
  theme: string;
  tap_count: number;
  is_active: boolean;
  url?: string;
}

/** Download a vCard for the profile — "Save Contact" on the digital card. */
export function downloadVCard(profile: NfcProfile) {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${profile.display_name}`,
    profile.title ? `TITLE:${profile.title}` : "",
    profile.bio ? `NOTE:${profile.bio.replace(/\n/g, " ")}` : "",
    profile.url ? `URL:${profile.url}` : "",
    "END:VCARD",
  ].filter(Boolean);
  const blob = new Blob([lines.join("\r\n")], { type: "text/vcard" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${profile.slug}.vcf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
