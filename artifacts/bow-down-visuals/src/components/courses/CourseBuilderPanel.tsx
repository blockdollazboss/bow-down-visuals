import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  GraduationCap, Loader2, Plus, Trash2, ArrowUp, ArrowDown, Eye, EyeOff,
  AlertCircle, CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  fetchCreatedCourses,
  createCourse,
  updateCourse,
  fetchCreatedCurriculum,
  replaceCurriculum,
  usd,
  type CourseProduct,
  type CurriculumSectionInput,
} from "@/lib/courses";

/* ─── Course Builder — docked in the seller Store Dashboard ────────────
   Sell lessons, not just videos: a course is a store product with a
   curriculum. The creator sets the price (typed here — nothing ever
   suggests or defaults it), builds sections of ordered lessons
   (video lessons point at their own published videos by ID; text
   lessons carry the lesson text; either can carry one attachment and
   a drip day), and publishes/unpublishes on the store rail. Buyers
   check out exactly like any other product in this dashboard. */

interface DraftLesson {
  title: string;
  kind: "video" | "text";
  videoId: string;
  body: string;
  attachmentTitle: string;
  attachmentUrl: string;
  dripDayOffset: number;
  isPreview: boolean;
}
interface DraftSection { title: string; lessons: DraftLesson[] }

const emptyLesson = (): DraftLesson => ({
  title: "", kind: "video", videoId: "", body: "",
  attachmentTitle: "", attachmentUrl: "", dripDayOffset: 0, isPreview: false,
});

export default function CourseBuilderPanel() {
  const isLight = useIsLightTheme();
  const { getAccessToken } = useAuth();
  const [courses, setCourses] = useState<CourseProduct[] | null>(null);
  const [notLive, setNotLive] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  /* create form */
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceDollars, setPriceDollars] = useState("");

  /* curriculum editor */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftSection[]>([]);
  const [editPrice, setEditPrice] = useState<Record<string, string>>({});

  const head = isLight ? "text-[#2A1E07]" : "text-white";
  const sub = isLight ? "text-[#6B5B36]" : "text-white/50";
  const cardCls = isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-white/10 bg-white/[0.03]";
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none ${isLight ? "border-[#C9A84C]/40 bg-white/70 text-zinc-900" : "border-white/10 bg-black/40 text-white"}`;

  const load = useCallback(async () => {
    try {
      setCourses(await fetchCreatedCourses(getAccessToken));
    } catch (e) {
      if ((e as { code?: string }).code === "COURSES_NOT_LIVE") setNotLive(true);
      else if ((e as { code?: string }).code === "NO_PROFILE" || /profile/i.test(e instanceof Error ? e.message : "")) setCourses([]);
      else setErr(e instanceof Error ? e.message : "Couldn't load your courses.");
    }
  }, [getAccessToken]);

  useEffect(() => { void load(); }, [load]);

  async function onCreate() {
    setErr(""); setNotice("");
    const cents = Math.round(Number(priceDollars) * 100);
    if (!title.trim()) { setErr("Give the course a title."); return; }
    if (priceDollars.trim() === "" || !Number.isFinite(cents) || cents < 0) {
      setErr("Set your price — it's your call, in dollars. $0 makes a free course fans claim with their email.");
      return;
    }
    setBusy("create");
    try {
      const product = await createCourse(getAccessToken, { title: title.trim(), description: description.trim(), priceCents: cents });
      setTitle(""); setDescription(""); setPriceDollars("");
      setNotice(`“${product.title}” created as a draft at ${usd(product.priceCents)} — add the curriculum, then publish.`);
      await load();
      await openEditor(product.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create the course.");
    } finally { setBusy(null); }
  }

  async function openEditor(productId: string) {
    setEditingId(productId);
    setDraft([]);
    try {
      const curr = await fetchCreatedCurriculum(getAccessToken, productId);
      setDraft(curr.sections.map((s) => ({
        title: s.title,
        lessons: s.lessons.map((l) => ({
          title: l.title,
          kind: l.kind,
          videoId: l.videoId ?? "",
          body: l.body,
          attachmentTitle: l.attachmentTitle ?? "",
          attachmentUrl: l.attachmentUrl ?? "",
          dripDayOffset: l.dripDayOffset,
          isPreview: l.isPreview,
        })),
      })));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load the curriculum.");
    }
  }

  async function onSaveCurriculum() {
    if (!editingId) return;
    setErr(""); setNotice("");
    setBusy("curriculum");
    try {
      const sections: CurriculumSectionInput[] = draft.map((s) => ({
        title: s.title,
        lessons: s.lessons.map((l) => ({
          title: l.title,
          kind: l.kind,
          videoId: l.kind === "video" && l.videoId.trim() ? l.videoId.trim() : null,
          body: l.body,
          attachmentTitle: l.attachmentUrl.trim() ? l.attachmentTitle.trim() || null : null,
          attachmentUrl: l.attachmentUrl.trim() || null,
          dripDayOffset: Math.max(0, Math.floor(l.dripDayOffset) || 0),
          isPreview: l.isPreview,
        })),
      }));
      await replaceCurriculum(getAccessToken, editingId, sections);
      setNotice("Curriculum saved — the order you see is the order buyers learn in.");
      await openEditor(editingId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the curriculum.");
    } finally { setBusy(null); }
  }

  async function onTogglePublish(c: CourseProduct) {
    setErr(""); setNotice("");
    setBusy(`publish-${c.id}`);
    try {
      const updated = await updateCourse(getAccessToken, c.id, { isActive: !c.isActive });
      setNotice(updated.isActive ? `“${updated.title}” is live in your store.` : `“${updated.title}” is back to draft — buyers can't see it.`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't update the course.");
    } finally { setBusy(null); }
  }

  async function onSavePrice(c: CourseProduct) {
    const raw = editPrice[c.id];
    if (raw === undefined) return;
    const cents = Math.round(Number(raw) * 100);
    if (!Number.isFinite(cents) || cents < 0) { setErr("A price is whole dollars-and-cents, $0 or more."); return; }
    setBusy(`price-${c.id}`);
    try {
      const updated = await updateCourse(getAccessToken, c.id, { priceCents: cents });
      setNotice(`“${updated.title}” now sells at ${usd(updated.priceCents)} — you set it, it stays.`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't set the price.");
    } finally { setBusy(null); }
  }

  const move = <T,>(arr: T[], i: number, dir: -1 | 1): T[] => {
    const j = i + dir;
    if (j < 0 || j >= arr.length) return arr;
    const next = [...arr];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  };

  if (notLive) {
    return (
      <div className={`mt-5 rounded-2xl border p-5 ${cardCls}`}>
        <h3 className={`flex items-center gap-2 text-sm font-black uppercase tracking-wider ${head}`}>
          <GraduationCap className="h-4 w-4 text-primary" /> Courses
        </h3>
        <p className={`mt-1 text-xs leading-relaxed ${sub}`}>
          Creator courses land with the next database update — the builder opens right here when they do.
        </p>
      </div>
    );
  }

  return (
    <div className={`mt-5 rounded-2xl border p-5 ${cardCls}`}>
      <h3 className={`flex items-center gap-2 text-sm font-black uppercase tracking-wider ${head}`}>
        <GraduationCap className="h-4 w-4 text-primary" /> Sell a course
      </h3>
      <p className={`mt-1 text-xs leading-relaxed ${sub}`}>
        Lessons, not just videos: sections of ordered lessons with a schedule (drip days after purchase),
        a free preview lesson, and buyer progress saved as they learn. It sells through this same store —
        same checkout, same flat platform fee — and buyers find it under My Courses in the Academy.
      </p>

      {err && <p className="mt-3 flex items-start gap-1.5 text-xs font-bold text-red-500"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {err}</p>}
      {notice && <p className="mt-3 flex items-start gap-1.5 text-xs font-bold text-emerald-500"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {notice}</p>}

      {/* create */}
      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_140px_auto]">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Course title" className={inputCls} maxLength={160} />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What will they learn? (one line sells it)" className={inputCls} maxLength={5000} />
        <input value={priceDollars} onChange={(e) => setPriceDollars(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Your price $" inputMode="decimal" className={inputCls} aria-label="Course price in dollars — you set it" />
        <button type="button" onClick={() => void onCreate()} disabled={busy === "create"} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black disabled:opacity-50">
          {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create course
        </button>
      </div>
      <p className={`mt-1.5 text-[11px] ${sub}`}>The price is yours — type what the transformation is worth. $0 = a free course fans claim with their email.</p>

      {/* course list */}
      {!courses ? (
        <div className="mt-5 flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : courses.length === 0 ? (
        <p className={`mt-5 text-sm ${sub}`}>No courses yet — your first one starts with the form above.</p>
      ) : (
        <div className="mt-5 space-y-3">
          {courses.map((c) => (
            <div key={c.id} className={`rounded-xl border p-4 ${isLight ? "border-[#C9A84C]/30" : "border-white/[0.08]"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-bold ${head}`}>{c.title}</p>
                  <p className={`text-xs ${sub}`}>
                    {c.isActive ? "Live in your store" : "Draft — buyers can't see it"} ·{" "}
                    <Link href={c.productUrl} className="font-semibold text-primary hover:underline">Sales page</Link>
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5">
                  <span className={`text-xs ${sub}`}>$</span>
                  <input
                    value={editPrice[c.id] ?? (c.priceCents / 100).toFixed(2)}
                    onChange={(e) => setEditPrice((m) => ({ ...m, [c.id]: e.target.value.replace(/[^0-9.]/g, "") }))}
                    className={`w-24 rounded-lg border px-2 py-1.5 text-sm ${isLight ? "border-[#C9A84C]/40 bg-white/70 text-zinc-900" : "border-white/10 bg-black/40 text-white"}`}
                    aria-label={`Price for ${c.title} in dollars`}
                  />
                  <button type="button" onClick={() => void onSavePrice(c)} disabled={busy === `price-${c.id}`} className="rounded-lg border border-primary/50 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary hover:text-black disabled:opacity-50">Set price</button>
                </span>
                <button type="button" onClick={() => void onTogglePublish(c)} disabled={busy === `publish-${c.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:border-primary/50 hover:text-primary disabled:opacity-50">
                  {c.isActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {c.isActive ? "Unpublish" : "Publish"}
                </button>
                <button type="button" onClick={() => (editingId === c.id ? setEditingId(null) : void openEditor(c.id))} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black">
                  {editingId === c.id ? "Close builder" : "Build curriculum"}
                </button>
              </div>

              {editingId === c.id && (
                <div className="mt-4 space-y-4">
                  {draft.map((section, si) => (
                    <div key={si} className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/[0.07] bg-black/30"}`}>
                      <div className="flex items-center gap-2">
                        <input value={section.title} onChange={(e) => setDraft((d) => d.map((s, i) => (i === si ? { ...s, title: e.target.value } : s)))} placeholder={`Section ${si + 1} title`} className={inputCls} maxLength={200} />
                        <button type="button" aria-label="Move section up" onClick={() => setDraft((d) => move(d, si, -1))} className="shrink-0 text-white/50 hover:text-primary"><ArrowUp className="h-4 w-4" /></button>
                        <button type="button" aria-label="Move section down" onClick={() => setDraft((d) => move(d, si, 1))} className="shrink-0 text-white/50 hover:text-primary"><ArrowDown className="h-4 w-4" /></button>
                        <button type="button" aria-label="Remove section" onClick={() => setDraft((d) => d.filter((_, i) => i !== si))} className="shrink-0 text-white/50 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                      </div>
                      <div className="mt-3 space-y-3">
                        {section.lessons.map((lesson, li) => (
                          <div key={li} className={`rounded-lg border p-3 ${isLight ? "border-[#C9A84C]/20" : "border-white/[0.06]"}`}>
                            <div className="flex items-center gap-2">
                              <input value={lesson.title} onChange={(e) => setDraft((d) => d.map((s, i) => i === si ? { ...s, lessons: s.lessons.map((l, j) => (j === li ? { ...l, title: e.target.value } : l)) } : s))} placeholder={`Lesson ${li + 1} title`} className={inputCls} maxLength={200} />
                              <select value={lesson.kind} onChange={(e) => setDraft((d) => d.map((s, i) => i === si ? { ...s, lessons: s.lessons.map((l, j) => (j === li ? { ...l, kind: e.target.value as "video" | "text" } : l)) } : s))} className={`shrink-0 rounded-lg border px-2 py-2 text-sm ${isLight ? "border-[#C9A84C]/40 bg-white/70 text-zinc-900" : "border-white/10 bg-black/40 text-white"}`} aria-label="Lesson kind">
                                <option value="video">Video</option>
                                <option value="text">Text</option>
                              </select>
                              <button type="button" aria-label="Move lesson up" onClick={() => setDraft((d) => d.map((s, i) => i === si ? { ...s, lessons: move(s.lessons, li, -1) } : s))} className="shrink-0 text-white/50 hover:text-primary"><ArrowUp className="h-4 w-4" /></button>
                              <button type="button" aria-label="Move lesson down" onClick={() => setDraft((d) => d.map((s, i) => i === si ? { ...s, lessons: move(s.lessons, li, 1) } : s))} className="shrink-0 text-white/50 hover:text-primary"><ArrowDown className="h-4 w-4" /></button>
                              <button type="button" aria-label="Remove lesson" onClick={() => setDraft((d) => d.map((s, i) => i === si ? { ...s, lessons: s.lessons.filter((_, j) => j !== li) } : s))} className="shrink-0 text-white/50 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                            </div>
                            {lesson.kind === "video" && (
                              <input value={lesson.videoId} onChange={(e) => setDraft((d) => d.map((s, i) => i === si ? { ...s, lessons: s.lessons.map((l, j) => (j === li ? { ...l, videoId: e.target.value } : l)) } : s))} placeholder="Your published video's ID (from its creator-tools page)" className={`${inputCls} mt-2`} />
                            )}
                            <textarea value={lesson.body} onChange={(e) => setDraft((d) => d.map((s, i) => i === si ? { ...s, lessons: s.lessons.map((l, j) => (j === li ? { ...l, body: e.target.value } : l)) } : s))} placeholder={lesson.kind === "text" ? "The lesson itself — write it out in full." : "Lesson notes (optional for video lessons)"} className={`${inputCls} mt-2 min-h-[64px]`} maxLength={50000} />
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <input value={lesson.attachmentTitle} onChange={(e) => setDraft((d) => d.map((s, i) => i === si ? { ...s, lessons: s.lessons.map((l, j) => (j === li ? { ...l, attachmentTitle: e.target.value } : l)) } : s))} placeholder="Attachment title (optional)" className={inputCls} maxLength={200} />
                              <input value={lesson.attachmentUrl} onChange={(e) => setDraft((d) => d.map((s, i) => i === si ? { ...s, lessons: s.lessons.map((l, j) => (j === li ? { ...l, attachmentUrl: e.target.value } : l)) } : s))} placeholder="Attachment link (optional)" className={inputCls} maxLength={2048} />
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
                              <label className={`inline-flex items-center gap-1.5 ${sub}`}>
                                Unlocks on day
                                <input type="number" min={0} max={3650} value={lesson.dripDayOffset} onChange={(e) => setDraft((d) => d.map((s, i) => i === si ? { ...s, lessons: s.lessons.map((l, j) => (j === li ? { ...l, dripDayOffset: Number(e.target.value) } : l)) } : s))} className={`w-20 rounded-lg border px-2 py-1.5 ${isLight ? "border-[#C9A84C]/40 bg-white/70 text-zinc-900" : "border-white/10 bg-black/40 text-white"}`} />
                                after purchase (0 = day one)
                              </label>
                              <label className={`inline-flex items-center gap-1.5 font-semibold ${sub}`}>
                                <input type="checkbox" checked={lesson.isPreview} onChange={(e) => setDraft((d) => d.map((s, i) => i === si ? { ...s, lessons: s.lessons.map((l, j) => (j === li ? { ...l, isPreview: e.target.checked } : l)) } : s))} />
                                Free preview (anyone can watch — your sample)
                              </label>
                            </div>
                          </div>
                        ))}
                        <button type="button" onClick={() => setDraft((d) => d.map((s, i) => i === si ? { ...s, lessons: [...s.lessons, emptyLesson()] } : s))} className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary hover:text-black">
                          <Plus className="h-3.5 w-3.5" /> Add lesson
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setDraft((d) => [...d, { title: "", lessons: [] }])} className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 px-3 py-2 text-xs font-bold text-primary hover:bg-primary hover:text-black">
                      <Plus className="h-3.5 w-3.5" /> Add section
                    </button>
                    <button type="button" onClick={() => void onSaveCurriculum()} disabled={busy === "curriculum"} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-black disabled:opacity-50">
                      {busy === "curriculum" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save curriculum
                    </button>
                  </div>
                  <p className={`text-[11px] ${sub}`}>Saving replaces the curriculum — lessons keep the order shown here. Removing a lesson removes its progress too.</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
