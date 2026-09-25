import { useCallback, useEffect, useState } from "react";
import { Loader2, Upload, MapPin, Link2, Trash2, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

interface LocationRecord {
  id: string;
  label: string;
  image_url: string;
  created_at: string;
}

export default function LocationsPage() {
  const { getAccessToken } = useAuth();
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const loadLocations = useCallback(async () => {
    try {
      const res = await fetch("/api/locations", { headers: await authHeaders() });
      const data = (await res.json()) as { locations?: LocationRecord[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not load locations.");
      setLocations(data.locations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load locations.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  async function handleAddByUrl() {
    if (!label.trim() || !imageUrl.trim()) {
      setError("Give the location a name and an image URL.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), image_url: imageUrl.trim() }),
      });
      const data = (await res.json()) as { location?: LocationRecord; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not save location.");
      setLabel("");
      setImageUrl("");
      await loadLocations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save location.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(file: File) {
    if (!label.trim()) {
      setError("Name the location first, then choose an image.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("label", label.trim());
      const res = await fetch("/api/locations/upload", {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      });
      const data = (await res.json()) as { location?: LocationRecord; error?: string };
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setLabel("");
      await loadLocations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/locations/${id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not delete location.");
      setLocations((prev) => prev.filter((l) => l.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete location.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white px-4 py-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <MapPin className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Locations</h1>
      </div>
      <p className="text-sm text-white/50 mb-6">
        Save places for your music videos — throne rooms, stages, streets, skies.
        Pick them visually when you build scenes instead of typing descriptions.
      </p>

      {/* Add */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 mb-6">
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add a location
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Location name (e.g. Golden Throne Room)"
            disabled={saving}
            className="flex-1 min-w-[160px] rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25"
          />
          <input
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="Image URL (optional if uploading)"
            disabled={saving}
            className="flex-1 min-w-[200px] rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25"
          />
          <Button
            onClick={() => void handleAddByUrl()}
            disabled={saving}
            className="inline-flex items-center gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Save
          </Button>
          <label
            className={`inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer ${saving ? "opacity-50 pointer-events-none" : ""}`}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload image
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={saving}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {/* Gallery */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-white/40" />
        </div>
      ) : locations.length === 0 ? (
        <p className="text-sm text-white/40 py-12 text-center">
          No locations yet. Add your first one above.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {locations.map((l) => (
            <div
              key={l.id}
              className="group rounded-xl overflow-hidden bg-white/[0.03] border border-white/[0.06] hover:border-primary/40 transition-colors"
            >
              <div className="relative aspect-video bg-black/60">
                <img
                  src={l.image_url}
                  alt={l.label}
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
                <button
                  onClick={() => void handleDelete(l.id)}
                  disabled={deletingId === l.id}
                  title="Remove location"
                  className="absolute top-2 right-2 rounded-lg bg-black/70 border border-white/10 p-1.5 text-white/60 hover:text-red-400 hover:border-red-400/40 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all"
                >
                  {deletingId === l.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="px-3 py-2.5 text-sm font-semibold truncate">{l.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
