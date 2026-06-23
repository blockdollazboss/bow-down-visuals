import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Archive, ArrowLeft, Save, ChevronRight, CheckCircle2,
  Loader2, Trash2, Pencil, Eye, X, Plus, Upload, ImageIcon,
} from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";

/* ─────────────────────────── TYPES ─────────────────────────── */

interface ArtistVaultRecord {
  id: string;
  artist_name: string;
  artist_type: string | null;
  artist_description: string | null;
  genre: string | null;
  visual_style: string | null;
  hair: string | null;
  tattoos: string | null;
  jewelry: string | null;
  clothing_style: string | null;
  brand_colors: string | null;
  logo_description: string | null;
  image_reference_notes: string | null;
  do_not_change_rules: string | null;
  special_style_rules: string | null;
  photo_url: string | null;
  created_at: string;
}

interface FormValues {
  artistName: string;
  artistType: string;
  artistDescription: string;
  genre: string;
  visualStyle: string;
  hair: string;
  tattoos: string;
  jewelry: string;
  clothingStyle: string;
  brandColors: string;
  logoDescription: string;
  imageReferenceNotes: string;
  doNotChangeRules: string;
  specialStyleRules: string;
}

/* ─────────────────────────── OPTIONS ─────────────────────────── */

const ARTIST_TYPES = [
  "Rapper", "Singer", "Producer", "AI Artist",
  "Content Creator", "Label", "Kids Music Creator", "Other",
];

const GENRES = [
  "Hip Hop", "Drill", "Trap", "R&B", "Pop",
  "Afrobeats", "Dancehall", "Gospel", "Kids Music",
  "Rock", "Country", "Other",
];

const VISUAL_STYLES = [
  "Street Cinematic", "Luxury Rap", "Dark Emotional", "Cartoon",
  "Anime", "Kids Friendly", "Performance", "Club",
  "Romantic R&B", "Documentary",
];

/* ─────────────────────────── STYLE CONSTANTS ─────────────────────────── */

const selectClass =
  "h-11 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 text-sm focus:outline-none focus:border-primary/50 focus:bg-white/[0.06] transition-colors appearance-none cursor-pointer";
const inputClass =
  "h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl";
const textareaClass =
  "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus:border-primary/50 focus:bg-white/[0.06] transition-colors rounded-xl resize-none";

/* ─────────────────────────── SUB-COMPONENTS ─────────────────────────── */

function StyledSelect({
  name, placeholder, options, value, onChange,
}: {
  name: string; placeholder: string; options: string[];
  value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select name={name} value={value} onChange={(e) => onChange(e.target.value)}
        className={selectClass} style={{ colorScheme: "dark" }}>
        <option value="" disabled style={{ background: "#111" }}>{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o} style={{ background: "#111" }}>{o}</option>
        ))}
      </select>
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 rotate-90 pointer-events-none" />
    </div>
  );
}

function FieldWrapper({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-white/70 uppercase tracking-wider">{label}</Label>
      {hint && <p className="text-xs text-white/30 -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
      <p className="text-xs text-white/40 uppercase tracking-wider font-semibold mb-1">{label}</p>
      <p className="text-sm text-white/80 whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function VaultModal({ vault, onClose, onEdit }: {
  vault: ArtistVaultRecord; onClose: () => void; onEdit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 overflow-y-auto">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl border border-white/[0.08] bg-[#0a0a0a] p-6 md:p-8 shadow-2xl my-auto">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-12 w-12 rounded-xl overflow-hidden shrink-0">
              {vault.photo_url ? (
                <img src={vault.photo_url} alt={vault.artist_name} className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full bg-primary flex items-center justify-center">
                  <span className="text-white font-black text-xl">
                    {(vault.artist_name || "A")[0].toUpperCase()}
                  </span>
                </div>
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-black text-white truncate">{vault.artist_name}</h2>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {vault.artist_type && (
                  <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">{vault.artist_type}</Badge>
                )}
                {vault.genre && (
                  <Badge className="bg-white/5 text-white/50 border-white/10 text-xs">{vault.genre}</Badge>
                )}
                {vault.visual_style && (
                  <Badge className="bg-white/5 text-white/50 border-white/10 text-xs">{vault.visual_style}</Badge>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors shrink-0 ml-3">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <DetailRow label="Artist Description" value={vault.artist_description} />
          <DetailRow label="Hair" value={vault.hair} />
          <DetailRow label="Tattoos" value={vault.tattoos} />
          <DetailRow label="Jewelry" value={vault.jewelry} />
          <DetailRow label="Clothing Style" value={vault.clothing_style} />
          <DetailRow label="Brand Colors" value={vault.brand_colors} />
          <DetailRow label="Logo Description" value={vault.logo_description} />
          <DetailRow label="Image Reference Notes" value={vault.image_reference_notes} />
        </div>

        {vault.do_not_change_rules && (
          <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4 mb-3">
            <p className="text-xs text-red-400/80 uppercase tracking-wider font-semibold mb-1">⛔ Do Not Change Rules</p>
            <p className="text-sm text-white/70 whitespace-pre-wrap">{vault.do_not_change_rules}</p>
          </div>
        )}
        {vault.special_style_rules && (
          <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 mb-3">
            <p className="text-xs text-primary/80 uppercase tracking-wider font-semibold mb-1">✅ Special Style Rules</p>
            <p className="text-sm text-white/70 whitespace-pre-wrap">{vault.special_style_rules}</p>
          </div>
        )}

        <div className="flex gap-3 mt-6 pt-4 border-t border-white/[0.06]">
          <Button onClick={onEdit} className="flex-1 gold-glow font-bold rounded-xl gap-2">
            <Pencil className="h-4 w-4" /> Edit Profile
          </Button>
          <Button onClick={onClose} variant="ghost" className="text-white/40 hover:text-white rounded-xl px-6">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function VaultCard({ vault, onOpen, onEdit, onDelete }: {
  vault: ArtistVaultRecord;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 hover:border-white/[0.12] transition-colors">
      <div className="flex items-start gap-3 mb-3">
        <div className="h-10 w-10 rounded-xl overflow-hidden shrink-0">
          {vault.photo_url ? (
            <img src={vault.photo_url} alt={vault.artist_name} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-primary flex items-center justify-center">
              <span className="text-white font-black text-lg">
                {(vault.artist_name || "A")[0].toUpperCase()}
              </span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-white truncate">{vault.artist_name}</h3>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {vault.artist_type && (
              <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">{vault.artist_type}</Badge>
            )}
            {vault.genre && (
              <Badge className="bg-white/5 text-white/50 border-white/10 text-xs">{vault.genre}</Badge>
            )}
            {vault.visual_style && (
              <Badge className="bg-white/5 text-white/50 border-white/10 text-xs hidden sm:inline-flex">
                {vault.visual_style}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {vault.artist_description && (
        <p className="text-xs text-white/40 line-clamp-2 mb-3">{vault.artist_description}</p>
      )}

      <div className="flex items-center gap-2 pt-3 border-t border-white/[0.05]">
        <button onClick={onOpen}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/60 bg-white/[0.04] hover:bg-white/[0.08] hover:text-white transition-colors">
          <Eye className="h-3.5 w-3.5" /> Open
        </button>
        <button onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/60 bg-white/[0.04] hover:bg-primary/10 hover:text-primary transition-colors">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </button>
        <button onClick={onDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 bg-white/[0.03] hover:bg-red-500/10 hover:text-red-400 transition-colors ml-auto">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────── PAGE ─────────────────────────── */

export default function ArtistVault() {
  const { getAccessToken, user } = useAuth();
  const [vaults, setVaults] = useState<ArtistVaultRecord[]>([]);
  const [loadingVaults, setLoadingVaults] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [openVault, setOpenVault] = useState<ArtistVaultRecord | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const { register, handleSubmit, watch, setValue, reset } = useForm<FormValues>({
    defaultValues: {
      artistName: "", artistType: "", artistDescription: "",
      genre: "", visualStyle: "", hair: "", tattoos: "", jewelry: "",
      clothingStyle: "", brandColors: "", logoDescription: "",
      imageReferenceNotes: "", doNotChangeRules: "", specialStyleRules: "",
    },
  });

  const watched = watch();
  const isEditing = editId !== null;

  async function fetchVaults() {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/artist-vaults", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = (await res.json()) as { vaults: ArtistVaultRecord[] };
        setVaults(data.vaults);
      }
    } catch {
      /* silent */
    } finally {
      setLoadingVaults(false);
    }
  }

  useEffect(() => { fetchVaults(); }, []);

  async function uploadPhoto(file: File) {
    if (!user) return;
    const MAX_MB = 5;
    if (file.size > MAX_MB * 1024 * 1024) {
      setPhotoError(`Image must be under ${MAX_MB}MB`);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setPhotoError("File must be an image (JPG, PNG, WebP)");
      return;
    }
    setUploadingPhoto(true);
    setPhotoError(null);
    try {
      const sb = getSupabase();
      const ext = file.name.split(".").pop() ?? "jpg";
      const filePath = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await sb.storage
        .from("artist-photos")
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = sb.storage
        .from("artist-photos")
        .getPublicUrl(filePath);
      setPhotoUrl(publicUrl);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function removePhoto() {
    if (!photoUrl || !user) { setPhotoUrl(null); return; }
    try {
      const sb = getSupabase();
      const url = new URL(photoUrl);
      const pathParts = url.pathname.split("/artist-photos/");
      if (pathParts[1]) {
        await sb.storage.from("artist-photos").remove([pathParts[1]]);
      }
    } catch { /* best-effort delete */ }
    setPhotoUrl(null);
  }

  function startNew() {
    setEditId(null);
    reset();
    setPhotoUrl(null);
    setPhotoError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startEdit(vault: ArtistVaultRecord) {
    setEditId(vault.id);
    setValue("artistName", vault.artist_name);
    setValue("artistType", vault.artist_type ?? "");
    setValue("artistDescription", vault.artist_description ?? "");
    setValue("genre", vault.genre ?? "");
    setValue("visualStyle", vault.visual_style ?? "");
    setValue("hair", vault.hair ?? "");
    setValue("tattoos", vault.tattoos ?? "");
    setValue("jewelry", vault.jewelry ?? "");
    setValue("clothingStyle", vault.clothing_style ?? "");
    setValue("brandColors", vault.brand_colors ?? "");
    setValue("logoDescription", vault.logo_description ?? "");
    setValue("imageReferenceNotes", vault.image_reference_notes ?? "");
    setValue("doNotChangeRules", vault.do_not_change_rules ?? "");
    setValue("specialStyleRules", vault.special_style_rules ?? "");
    setPhotoUrl(vault.photo_url ?? null);
    setPhotoError(null);
    setOpenVault(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function onSubmit(values: FormValues) {
    setSaving(true);
    setApiError(null);
    setSaveSuccess(false);
    try {
      const token = await getAccessToken();
      const body = {
        artistName: values.artistName,
        artistType: values.artistType || null,
        artistDescription: values.artistDescription || null,
        genre: values.genre || null,
        visualStyle: values.visualStyle || null,
        hair: values.hair || null,
        tattoos: values.tattoos || null,
        jewelry: values.jewelry || null,
        clothingStyle: values.clothingStyle || null,
        brandColors: values.brandColors || null,
        logoDescription: values.logoDescription || null,
        imageReferenceNotes: values.imageReferenceNotes || null,
        doNotChangeRules: values.doNotChangeRules || null,
        specialStyleRules: values.specialStyleRules || null,
        photoUrl: photoUrl || null,
      };
      const url = editId ? `/api/artist-vaults/${editId}` : "/api/artist-vaults";
      const method = editId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }
      await fetchVaults();
      setSaveSuccess(true);
      setEditId(null);
      reset();
      setPhotoUrl(null);
      setPhotoError(null);
      setTimeout(() => setSaveSuccess(false), 5000);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteVault(id: string) {
    if (!window.confirm("Delete this artist profile? This cannot be undone.")) return;
    try {
      const token = await getAccessToken();
      const vault = vaults.find((v) => v.id === id);
      if (vault?.photo_url) {
        try {
          const sb = getSupabase();
          const url = new URL(vault.photo_url);
          const pathParts = url.pathname.split("/artist-photos/");
          if (pathParts[1]) await sb.storage.from("artist-photos").remove([pathParts[1]]);
        } catch { /* best-effort */ }
      }
      await fetch(`/api/artist-vaults/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setVaults((prev) => prev.filter((v) => v.id !== id));
      if (editId === id) { setEditId(null); reset(); setPhotoUrl(null); }
    } catch {
      /* silent */
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <TopBar />

      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-yellow-600/8 rounded-full blur-[100px]" />
      </div>

      {openVault && (
        <VaultModal
          vault={openVault}
          onClose={() => setOpenVault(null)}
          onEdit={() => startEdit(openVault)}
        />
      )}

      <div className="relative z-10 max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14">

        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Dashboard
        </Link>

        {/* Page header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center">
              <Archive className="h-5 w-5 text-white" />
            </div>
            <Badge className="bg-white/5 text-white/40 border-white/10 text-xs font-bold tracking-wide">Free</Badge>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-3">Artist Profiles</h1>
          <p className="text-white/50 text-lg max-w-2xl">
            Save your artist's look, style, colors, and brand once — then load it on any tool to keep all your visuals consistent.
          </p>
          <div className="flex flex-wrap gap-2 mt-5">
            {["Artist Description", "Visual Style", "Hair & Tattoos", "Jewelry", "Clothing", "Brand Colors", "Do Not Change Rules", "Special Style Rules"].map((t) => (
              <span key={t} className="text-xs bg-white/[0.04] border border-white/[0.07] text-white/50 px-3 py-1 rounded-full">{t}</span>
            ))}
          </div>
        </div>

        {/* Status banners */}
        {saveSuccess && (
          <div className="mb-6 flex items-center gap-3 p-4 rounded-xl border border-primary/25 bg-primary/5">
            <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
            <p className="text-sm font-bold text-white">
              Artist profile {isEditing ? "updated" : "saved"} successfully!
            </p>
            <button onClick={() => setSaveSuccess(false)} className="ml-auto text-white/30 hover:text-white transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {apiError && (
          <div className="mb-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="text-sm text-red-400">{apiError}</p>
          </div>
        )}

        {/* Form card */}
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.05] bg-white/[0.01]">
            <div className="flex items-center gap-3">
              <div className="h-6 w-6 rounded-lg bg-primary/20 flex items-center justify-center">
                <Archive className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-sm font-bold text-white/70 uppercase tracking-wider">
                {isEditing ? "Edit Artist Profile" : "New Artist Profile"}
              </span>
            </div>
            {isEditing && (
              <button onClick={startNew}
                className="text-xs text-white/30 hover:text-white transition-colors flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" /> New Profile
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="p-6 md:p-8 space-y-8">

            {/* Row 1: Artist Name + Artist Type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Artist Name">
                <Input
                  {...register("artistName", { required: true })}
                  placeholder="Your stage name"
                  className={inputClass}
                />
              </FieldWrapper>
              <FieldWrapper label="Artist Type">
                <StyledSelect name="artistType" placeholder="Select type..." options={ARTIST_TYPES}
                  value={watched.artistType} onChange={(v) => setValue("artistType", v)} />
              </FieldWrapper>
            </div>

            {/* Artist Description */}
            <FieldWrapper label="Artist Description" hint="Describe who you are as an artist — story, sound, vibe, energy">
              <Textarea
                {...register("artistDescription")}
                placeholder="e.g. Young Black artist from Atlanta, street-meets-luxury sound, raw emotion with commercial appeal. Known for cinematic visuals and hard-hitting bars. Started with nothing, now building a legacy..."
                className={textareaClass}
                style={{ minHeight: "120px" }}
              />
            </FieldWrapper>

            {/* Row 2: Genre + Visual Style */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FieldWrapper label="Music Genre">
                <StyledSelect name="genre" placeholder="Select genre..." options={GENRES}
                  value={watched.genre} onChange={(v) => setValue("genre", v)} />
              </FieldWrapper>
              <FieldWrapper label="Visual Style">
                <StyledSelect name="visualStyle" placeholder="Select visual style..." options={VISUAL_STYLES}
                  value={watched.visualStyle} onChange={(v) => setValue("visualStyle", v)} />
              </FieldWrapper>
            </div>

            {/* Appearance section */}
            <div>
              <p className="text-xs font-bold text-white/30 uppercase tracking-wider mb-4">Appearance & Wardrobe</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Hair" hint="Color, length, style, any signature looks">
                  <Input {...register("hair")} placeholder="e.g. long dreads, black with gold tips..." className={inputClass} />
                </FieldWrapper>
                <FieldWrapper label="Tattoos" hint="Notable tattoos — placement and description">
                  <Input {...register("tattoos")} placeholder="e.g. neck tattoos, full left sleeve, chest piece..." className={inputClass} />
                </FieldWrapper>
                <FieldWrapper label="Jewelry" hint="Chains, rings, watches — your signature pieces">
                  <Input {...register("jewelry")} placeholder="e.g. gold chain cross pendant, diamond studs, AP watch..." className={inputClass} />
                </FieldWrapper>
                <FieldWrapper label="Clothing Style" hint="Your signature wardrobe aesthetic">
                  <Input {...register("clothingStyle")} placeholder="e.g. all black designer fits, vintage streetwear, no labels..." className={inputClass} />
                </FieldWrapper>
              </div>
            </div>

            {/* Brand section */}
            <div>
              <p className="text-xs font-bold text-white/30 uppercase tracking-wider mb-4">Brand Identity</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FieldWrapper label="Brand Colors" hint="Your signature color palette">
                  <Input {...register("brandColors")} placeholder="e.g. black, gold, and deep red..." className={inputClass} />
                </FieldWrapper>
                <FieldWrapper label="Logo Description" hint="Describe your logo or brand mark">
                  <Input {...register("logoDescription")} placeholder="e.g. initials in gothic font with a crown above..." className={inputClass} />
                </FieldWrapper>
              </div>
            </div>

            {/* Artist Photo Upload */}
            <div>
              <p className="text-xs font-bold text-white/30 uppercase tracking-wider mb-4">Artist Photo</p>
              <div className="flex items-start gap-5">
                {/* Preview */}
                <div className="shrink-0">
                  {photoUrl ? (
                    <div className="relative h-24 w-24 rounded-xl overflow-hidden border border-white/[0.12]">
                      <img src={photoUrl} alt="Artist" className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="h-24 w-24 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                      <ImageIcon className="h-8 w-8 text-white/20" />
                    </div>
                  )}
                </div>
                {/* Controls */}
                <div className="flex-1 space-y-2">
                  <p className="text-xs text-white/40">Upload a front-facing photo. Used as your visual reference across all AI tools. Max 5MB (JPG, PNG, WebP).</p>
                  <div className="flex flex-wrap gap-2">
                    <label className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-colors ${uploadingPhoto ? "opacity-50 pointer-events-none" : "bg-white/[0.06] hover:bg-white/[0.10] text-white/80 hover:text-white border border-white/[0.10]"}`}>
                      {uploadingPhoto ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Uploading...</>
                      ) : (
                        <><Upload className="h-4 w-4" /> {photoUrl ? "Replace Photo" : "Upload Photo"}</>
                      )}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadPhoto(file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {photoUrl && (
                      <button
                        type="button"
                        onClick={removePhoto}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-red-400/70 hover:text-red-400 bg-red-500/[0.04] hover:bg-red-500/10 border border-red-500/10 hover:border-red-500/20 transition-colors"
                      >
                        <X className="h-4 w-4" /> Remove
                      </button>
                    )}
                  </div>
                  {photoError && <p className="text-xs text-red-400">{photoError}</p>}
                </div>
              </div>
            </div>

            {/* Image reference notes */}
            <FieldWrapper label="Image Reference Notes" hint="Describe visual inspirations or aesthetic references for AI tools">
              <Textarea
                {...register("imageReferenceNotes")}
                placeholder="e.g. dark cinematic like Drake's Scorpion era, luxury but street raw, always a black and gold color story, moody low-key lighting..."
                className={textareaClass}
                style={{ minHeight: "100px" }}
              />
            </FieldWrapper>

            {/* Do Not Change Rules */}
            <div className="rounded-xl border border-red-500/15 bg-red-500/[0.03] p-5">
              <FieldWrapper label="⛔ Do Not Change Rules" hint="Hard rules the AI must NEVER violate for this artist">
                <Textarea
                  {...register("doNotChangeRules")}
                  placeholder="e.g. Never show the artist without jewelry. Never use cartoon or anime visual style. Do not use pastel or pink colors. Never generate the artist without their signature chain. Never make lyrics sound too soft or pop..."
                  className={textareaClass}
                  style={{ minHeight: "110px" }}
                />
              </FieldWrapper>
            </div>

            {/* Special Style Rules */}
            <div className="rounded-xl border border-primary/15 bg-primary/[0.03] p-5">
              <FieldWrapper label="✅ Special Style Rules" hint="Instructions the AI should always follow for this artist">
                <Textarea
                  {...register("specialStyleRules")}
                  placeholder="e.g. Always include crown symbolism. Lyrics should always use street elevated language. Thumbnails always have gold text on dark background. Video scenes should always include dramatic lighting. Always reference loyalty and legacy themes..."
                  className={textareaClass}
                  style={{ minHeight: "110px" }}
                />
              </FieldWrapper>
            </div>

            {/* Submit buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                type="submit"
                size="lg"
                disabled={saving}
                className="gold-glow font-bold text-base px-10 rounded-xl gap-3"
                style={{ height: "52px" }}
              >
                {saving ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> Saving...</>
                ) : isEditing ? (
                  <><Save className="h-5 w-5" /> Update Artist Profile</>
                ) : (
                  <><Save className="h-5 w-5" /> Save Artist Profile</>
                )}
              </Button>
              {isEditing && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={startNew}
                  disabled={saving}
                  className="font-bold text-base px-6 rounded-xl text-white/40 hover:text-white"
                  style={{ height: "52px" }}
                >
                  Cancel
                </Button>
              )}
              <p className="w-full text-white/25 text-xs">Free — no credits required</p>
            </div>

          </form>
        </div>

        {/* Saved Profiles Grid */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-black text-white">Saved Profiles</h2>
              <p className="text-sm text-white/40 mt-1">
                {loadingVaults
                  ? "Loading..."
                  : vaults.length === 0
                    ? "No profiles saved yet"
                    : `${vaults.length} profile${vaults.length !== 1 ? "s" : ""}`}
              </p>
            </div>
            {vaults.length > 0 && (
              <button
                onClick={startNew}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03] text-sm text-white/60 hover:text-white hover:border-primary/30 hover:bg-primary/5 transition-colors"
              >
                <Plus className="h-4 w-4" /> New Profile
              </button>
            )}
          </div>

          {loadingVaults ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-white/30" />
            </div>
          ) : vaults.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-10 text-center">
              <Archive className="h-10 w-10 text-white/15 mx-auto mb-3" />
              <p className="text-white/30 text-sm">Fill out the form above to save your first artist profile.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {vaults.map((vault) => (
                <VaultCard
                  key={vault.id}
                  vault={vault}
                  onOpen={() => setOpenVault(vault)}
                  onEdit={() => startEdit(vault)}
                  onDelete={() => deleteVault(vault.id)}
                />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
