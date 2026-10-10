import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePageTitle } from "@/hooks/use-page-title";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  BookOpen, Plus, Trash2, ChevronLeft, Sparkles, Loader2,
  FileText, PenLine, X, Check, Lightbulb, RefreshCw, Expand, ListOrdered, Type, Megaphone,
  Download, Image as ImageIcon, Printer, Package,
} from "lucide-react";

/* ── Types ── */

interface Book {
  id: string;
  title: string;
  subtitle?: string | null;
  authorName?: string | null;
  genre?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  coverUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Chapter {
  id: string;
  title: string;
  content: string;
  position: number;
  aiNotes?: string | null;
  wordCount: number;
  updatedAt: string;
}

type AssistAction = "continue" | "rewrite" | "expand" | "outline" | "title-ideas" | "blurb";

const ASSIST_ACTIONS: Array<{ id: AssistAction; label: string; icon: typeof PenLine; chapterOnly: boolean }> = [
  { id: "continue", label: "Continue writing", icon: PenLine, chapterOnly: true },
  { id: "rewrite", label: "Rewrite passage", icon: RefreshCw, chapterOnly: true },
  { id: "expand", label: "Expand scene", icon: Expand, chapterOnly: true },
  { id: "outline", label: "Chapter outline", icon: ListOrdered, chapterOnly: false },
  { id: "title-ideas", label: "Title ideas", icon: Type, chapterOnly: false },
  { id: "blurb", label: "Back-cover blurb", icon: Megaphone, chapterOnly: false },
];

/* ── Main page ── */

export default function Books() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  usePageTitle("Thy Books — AI Book Studio", "Write, design, and publish books with AI assistance.");

  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [showNewBook, setShowNewBook] = useState(false);

  const loadBooks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await confirmedFetch("/api/books", { skipConfirm: true });
      if (!res) return;
      const data = await res.json();
      setBooks(data.books ?? []);
    } catch {
      toast({ title: "Failed to load books", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [confirmedFetch, toast]);

  useEffect(() => { loadBooks(); }, [loadBooks]);

  const loadBook = useCallback(async (book: Book) => {
    try {
      const res = await confirmedFetch(`/api/books/${book.id}`, { skipConfirm: true });
      if (!res) return;
      const data = await res.json();
      setSelectedBook(data.book);
      setChapters(data.chapters ?? []);
    } catch {
      toast({ title: "Failed to open book", variant: "destructive" });
    }
  }, [confirmedFetch, toast]);

  const handleDeleteBook = async (id: string) => {
    if (!window.confirm("Delete this book and all its chapters?")) return;
    const res = await confirmedFetch(`/api/books/${id}`, { method: "DELETE", skipConfirm: true });
    if (!res) return;
    setBooks((bs) => bs.filter((b) => b.id !== id));
    if (selectedBook?.id === id) {
      setSelectedBook(null);
      setChapters([]);
    }
    toast({ title: "Book deleted" });
  };

  if (selectedBook) {
    return (
      <BookEditor
        book={selectedBook}
        chapters={chapters}
        setChapters={setChapters}
        onBack={() => { setSelectedBook(null); setChapters([]); loadBooks(); }}
        onBookUpdate={(b) => {
          setSelectedBook(b);
          setBooks((bs) => bs.map((x) => (x.id === b.id ? b : x)));
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-10">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-b from-[#f5e6b8] via-[#d4af37] to-[#8a6d1f]" style={{ fontFamily: "Georgia, serif" }}>
              Thy Books
            </h1>
            <p className="text-white/50 mt-1">Write, design, and publish books with AI assistance.</p>
          </div>
          <Button onClick={() => setShowNewBook(true)} className="bg-[#C9A84C] text-black font-bold hover:bg-[#e8c86a]">
            <Plus className="h-4 w-4 mr-2" /> New Book
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[#C9A84C]" />
          </div>
        ) : books.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-white/10 rounded-2xl">
            <BookOpen className="h-12 w-12 mx-auto text-[#C9A84C]/50 mb-4" />
            <p className="text-white/60 text-lg font-semibold">No books yet</p>
            <p className="text-white/40 text-sm mt-1 mb-6">Start your first book — AI helps you write every chapter.</p>
            <Button onClick={() => setShowNewBook(true)} className="bg-[#C9A84C] text-black font-bold hover:bg-[#e8c86a]">
              <Plus className="h-4 w-4 mr-2" /> Create Your First Book
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {books.map((book) => (
              <div
                key={book.id}
                className="border border-white/10 rounded-2xl p-5 bg-white/[0.02] hover:border-[#C9A84C]/40 transition-colors cursor-pointer group"
                onClick={() => loadBook(book)}
              >
                <div className="flex items-start justify-between">
                  <BookOpen className="h-8 w-8 text-[#C9A84C]" />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteBook(book.id); }}
                    className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 transition-all"
                    title="Delete book"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <h3 className="font-bold text-lg mt-3 truncate">{book.title}</h3>
                {book.genre && <p className="text-[#C9A84C]/80 text-xs font-semibold uppercase tracking-wider mt-1">{book.genre}</p>}
                {book.description && <p className="text-white/40 text-sm mt-2 line-clamp-2">{book.description}</p>}
                <p className="text-white/25 text-xs mt-3">
                  Updated {new Date(book.updatedAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {showNewBook && (
        <NewBookModal
          onClose={() => setShowNewBook(false)}
          onCreated={(book) => {
            setShowNewBook(false);
            setBooks((bs) => [book, ...bs]);
            loadBook(book);
          }}
        />
      )}
    </div>
  );
}

/* ── New book modal ── */

function NewBookModal({ onClose, onCreated }: { onClose: () => void; onCreated: (b: Book) => void }) {
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [description, setDescription] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!title.trim()) {
      toast({ title: "Give your book a title", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await confirmedFetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), genre: genre.trim(), description: description.trim(), author_name: authorName.trim() }),
        skipConfirm: true,
      });
      if (!res) return;
      const data = await res.json();
      onCreated(data.book);
      toast({ title: "Book created" });
    } catch {
      toast({ title: "Failed to create book", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#111] border border-[#C9A84C]/30 rounded-2xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-[#C9A84C]" style={{ fontFamily: "Georgia, serif" }}>New Book</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My Amazing Book" className="mt-1 bg-white/5 border-white/10" />
          </div>
          <div>
            <Label>Author name</Label>
            <Input value={authorName} onChange={(e) => setAuthorName(e.target.value)} placeholder="Pen name or real name" className="mt-1 bg-white/5 border-white/10" />
          </div>
          <div>
            <Label>Genre</Label>
            <Input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Memoir, Business, Fiction, Self-help…" className="mt-1 bg-white/5 border-white/10" />
          </div>
          <div>
            <Label>What is this book about?</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A sentence or two — AI uses this to help you write." rows={3} className="mt-1 bg-white/5 border-white/10" />
          </div>
          <Button onClick={create} disabled={saving} className="w-full bg-[#C9A84C] text-black font-bold hover:bg-[#e8c86a]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Create Book
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Book editor: chapters + AI assist ── */

function BookEditor({
  book, chapters, setChapters, onBack, onBookUpdate,
}: {
  book: Book;
  chapters: Chapter[];
  setChapters: (c: Chapter[] | ((cs: Chapter[]) => Chapter[])) => void;
  onBack: () => void;
  onBookUpdate: (b: Book) => void;
}) {
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const [activeChapterId, setActiveChapterId] = useState<string | null>(chapters[0]?.id ?? null);
  const [content, setContent] = useState(chapters[0]?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [newChapterTitle, setNewChapterTitle] = useState("");
  const [addingChapter, setAddingChapter] = useState(false);
  const [exporting, setExporting] = useState<"epub" | "pdf" | null>(null);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeChapter = chapters.find((c) => c.id === activeChapterId) ?? null;
  const totalWords = chapters.reduce((a, c) => a + (c.id === activeChapterId ? countWords(content) : c.wordCount), 0);

  /* Switch chapter — load its content. */
  const selectChapter = (c: Chapter) => {
    setActiveChapterId(c.id);
    setContent(c.content);
  };

  /* Autosave with debounce. */
  const handleContentChange = (text: string) => {
    setContent(text);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveChapter(text), 1500);
  };

  const saveChapter = useCallback(async (text?: string) => {
    const chapterId = activeChapterId;
    if (!chapterId) return;
    const body = text ?? content;
    setSaving(true);
    try {
      const res = await confirmedFetch(`/api/books/${book.id}/chapters/${chapterId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: body }),
        skipConfirm: true,
      });
      if (!res) return;
      const data = await res.json();
      setChapters((cs) => cs.map((c) => (c.id === chapterId ? { ...c, content: body, wordCount: data.wordCount ?? countWords(body) } : c)));
    } finally {
      setSaving(false);
    }
  }, [activeChapterId, book.id, confirmedFetch, content, setChapters]);

  const addChapter = async () => {
    const title = newChapterTitle.trim() || `Chapter ${chapters.length + 1}`;
    setAddingChapter(true);
    try {
      const res = await confirmedFetch(`/api/books/${book.id}/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
        skipConfirm: true,
      });
      if (!res) return;
      const data = await res.json();
      const ch: Chapter = {
        id: data.chapter.id,
        title: data.chapter.title,
        content: "",
        position: data.chapter.position,
        aiNotes: null,
        wordCount: 0,
        updatedAt: data.chapter.updated_at,
      };
      setChapters((cs) => [...cs, ch]);
      setNewChapterTitle("");
      selectChapter(ch);
      toast({ title: "Chapter added" });
    } catch {
      toast({ title: "Failed to add chapter", variant: "destructive" });
    } finally {
      setAddingChapter(false);
    }
  };

  const deleteChapter = async (id: string) => {
    if (!window.confirm("Delete this chapter?")) return;
    const res = await confirmedFetch(`/api/books/${book.id}/chapters/${id}`, { method: "DELETE", skipConfirm: true });
    if (!res) return;
    setChapters((cs) => {
      const rest = cs.filter((c) => c.id !== id);
      if (activeChapterId === id) {
        const next = rest[0];
        setActiveChapterId(next?.id ?? null);
        setContent(next?.content ?? "");
      }
      return rest;
    });
    toast({ title: "Chapter deleted" });
  };

  /* Export the book as EPUB or PDF — downloads directly. */
  const exportBook = async (format: "epub" | "pdf") => {
    setExporting(format);
    try {
      const res = await fetch(`/api/books/${book.id}/export/${format}`, { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${book.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: `${format.toUpperCase()} exported` });
    } catch (err) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  /* Generate an AI cover for the book. */
  const generateCover = async () => {
    setGeneratingCover(true);
    try {
      const res = await confirmedFetch(`/api/books/${book.id}/cover/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res) return; // user cancelled the confirmation
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Cover generation failed");
      onBookUpdate({ ...book, coverUrl: data.cover_url });
      toast({ title: "Cover generated" });
    } catch (err) {
      toast({ title: "Cover failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setGeneratingCover(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-white/50 hover:text-white"><ChevronLeft className="h-6 w-6" /></button>
          <div>
            <h1 className="text-xl font-bold text-[#C9A84C]" style={{ fontFamily: "Georgia, serif" }}>{book.title}</h1>
            <p className="text-white/40 text-xs">{chapters.length} chapters · {totalWords.toLocaleString()} words {saving && "· saving…"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={generateCover}
            disabled={generatingCover}
            variant="outline"
            className="border-[#C9A84C]/40 text-[#C9A84C]"
            title="Generate AI cover (200 Visual Bucs)"
          >
            {generatingCover ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ImageIcon className="h-4 w-4 mr-2" />}
            Cover
          </Button>
          <Button
            onClick={() => exportBook("epub")}
            disabled={exporting !== null}
            variant="outline"
            className="border-white/20 text-white/70"
          >
            {exporting === "epub" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
            EPUB
          </Button>
          <Button
            onClick={() => exportBook("pdf")}
            disabled={exporting !== null}
            variant="outline"
            className="border-white/20 text-white/70"
          >
            {exporting === "pdf" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
            PDF
          </Button>
          <Button
            onClick={() => setShowPrint(true)}
            variant="outline"
            className="border-[#C9A84C]/40 text-[#C9A84C]"
            title="Print a physical copy via Lulu"
          >
            <Printer className="h-4 w-4 mr-2" />
            Print Book
          </Button>
          <Button onClick={() => saveChapter()} disabled={saving} variant="outline" className="border-[#C9A84C]/40 text-[#C9A84C]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />} Save
          </Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Chapter list */}
        <div className="w-64 shrink-0 border-r border-white/10 p-4 overflow-y-auto">
          <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">Chapters</p>
          <div className="space-y-1">
            {chapters.map((c, i) => (
              <div
                key={c.id}
                onClick={() => selectChapter(c)}
                className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm ${
                  c.id === activeChapterId ? "bg-[#C9A84C]/15 text-[#C9A84C] font-semibold" : "text-white/60 hover:bg-white/5"
                }`}
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate flex-1">{i + 1}. {c.title}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteChapter(c.id); }}
                  className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Input
              value={newChapterTitle}
              onChange={(e) => setNewChapterTitle(e.target.value)}
              placeholder="New chapter title"
              className="bg-white/5 border-white/10 text-sm"
              onKeyDown={(e) => e.key === "Enter" && addChapter()}
            />
            <Button onClick={addChapter} disabled={addingChapter} size="icon" className="bg-[#C9A84C] text-black shrink-0">
              {addingChapter ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 min-w-0 p-6 overflow-y-auto">
          {activeChapter ? (
            <>
              <Input
                value={activeChapter.title}
                onChange={(e) => {
                  const t = e.target.value;
                  setChapters((cs) => cs.map((c) => (c.id === activeChapter.id ? { ...c, title: t } : c)));
                }}
                onBlur={async () => {
                  await confirmedFetch(`/api/books/${book.id}/chapters/${activeChapter.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title: activeChapter.title }),
                    skipConfirm: true,
                  });
                }}
                className="text-2xl font-bold bg-transparent border-none px-0 mb-4 text-[#f5e6b8]"
                style={{ fontFamily: "Georgia, serif" }}
              />
              <Textarea
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder="Start writing… or ask the AI to help you."
                className="min-h-[50vh] bg-white/[0.02] border-white/10 text-white/90 leading-relaxed text-base"
                style={{ fontFamily: "Georgia, serif", fontSize: "17px", lineHeight: "1.8" }}
              />
              <p className="text-white/30 text-xs mt-2">{countWords(content).toLocaleString()} words in this chapter</p>
            </>
          ) : (
            <div className="text-center py-20 text-white/40">
              <PenLine className="h-10 w-10 mx-auto mb-4 text-[#C9A84C]/40" />
              <p>Add a chapter to start writing.</p>
            </div>
          )}
        </div>

        {/* AI assist panel */}
        <AiAssistPanel
          book={book}
          chapter={activeChapter}
          chapterContent={content}
          onInsert={(text) => handleContentChange(content ? `${content}\n\n${text}` : text)}
        />
      </div>

      {showPrint && (
        <PrintBookModal book={book} onClose={() => setShowPrint(false)} />
      )}
    </div>
  );
}

/* ── AI writing assistance panel ── */

interface ShippingForm {
  name: string;
  street1: string;
  street2: string;
  city: string;
  state_code: string;
  country_code: string;
  postcode: string;
  phone_number: string;
  contactEmail: string;
}

interface QuoteResult {
  podPackageId: string;
  pageCount: number;
  quantity: number;
  printCostUsd: number;
  currency: string;
  shippingOptions: Array<{ id: string; label: string; costUsd: number; currency: string; deliveryEstimate: string | null }>;
  priceVb: number;
  markup: number;
}

function PrintBookModal({ book, onClose }: { book: Book; onClose: () => void }) {
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const [step, setStep] = useState<"form" | "quote" | "done">("form");
  const [quoting, setQuoting] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [color, setColor] = useState<"bw" | "color">("bw");
  const [shippingLevel, setShippingLevel] = useState("MAIL");
  const [orderResult, setOrderResult] = useState<{ orderId: string; priceVb: number; totalUsd: number } | null>(null);
  const [form, setForm] = useState<ShippingForm>({
    name: "", street1: "", street2: "", city: "", state_code: "",
    country_code: "US", postcode: "", phone_number: "", contactEmail: "",
  });

  const set = (k: keyof ShippingForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const getQuote = async () => {
    if (!form.name || !form.street1 || !form.city || !form.postcode || !form.phone_number || !form.contactEmail) {
      toast({ title: "Fill in the shipping details first", variant: "destructive" });
      return;
    }
    setQuoting(true);
    try {
      const res = await confirmedFetch(`/api/books/${book.id}/print/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countryCode: form.country_code || "US",
          stateCode: form.state_code || undefined,
          postcode: form.postcode,
          quantity,
          color,
        }),
      });
      if (!res) { setQuoting(false); return; } // user cancelled
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Quote failed");
      setQuote(data);
      if (data.shippingOptions?.length > 0 && !data.shippingOptions.some((s: any) => s.id === shippingLevel)) {
        setShippingLevel(data.shippingOptions[0].id);
      }
      setStep("quote");
    } catch (err) {
      toast({ title: "Quote failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setQuoting(false);
    }
  };

  const placeOrder = async () => {
    setOrdering(true);
    try {
      const res = await confirmedFetch(`/api/books/${book.id}/print/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shippingAddress: {
            name: form.name,
            street1: form.street1,
            ...(form.street2 ? { street2: form.street2 } : {}),
            city: form.city,
            ...(form.state_code ? { state_code: form.state_code } : {}),
            country_code: form.country_code || "US",
            postcode: form.postcode,
            phone_number: form.phone_number,
          },
          shippingLevel,
          quantity,
          color,
          contactEmail: form.contactEmail,
        }),
      });
      if (!res) { setOrdering(false); return; } // user cancelled
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Order failed");
      setOrderResult(data);
      setStep("done");
      toast({ title: "Print order placed!" });
    } catch (err) {
      toast({ title: "Order failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setOrdering(false);
    }
  };

  const chosenShipping = quote?.shippingOptions.find((s) => s.id === shippingLevel);
  const totalUsd = (quote?.printCostUsd ?? 0) + (chosenShipping?.costUsd ?? 0);
  const totalVb = Math.ceil(totalUsd * 100 * 2 * (quote?.markup ?? 1.5));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-[#C9A84C]/30 bg-[#141414] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[#C9A84C]" style={{ fontFamily: "Georgia, serif" }}>
            <Printer className="inline h-5 w-5 mr-2 -mt-1" />
            Print "{book.title}"
          </h2>
          <button onClick={onClose} className="text-white/50 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        {step === "form" && (
          <div className="space-y-3">
            <p className="text-white/60 text-sm">6"×9" paperback, printed on demand by Lulu and shipped to you.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/60 text-xs">Copies</Label>
                <Input type="number" min={1} max={100} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} className="bg-black/40 border-white/10" />
              </div>
              <div>
                <Label className="text-white/60 text-xs">Interior</Label>
                <div className="flex gap-2 mt-1">
                  {(["bw", "color"] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`px-3 py-1.5 rounded-lg text-sm border ${color === c ? "border-[#C9A84C] text-[#C9A84C]" : "border-white/10 text-white/50"}`}
                    >
                      {c === "bw" ? "B&W" : "Color"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label className="text-white/60 text-xs">Full name</Label><Input value={form.name} onChange={set("name")} className="bg-black/40 border-white/10" /></div>
              <div className="col-span-2"><Label className="text-white/60 text-xs">Street address</Label><Input value={form.street1} onChange={set("street1")} className="bg-black/40 border-white/10" /></div>
              <div className="col-span-2"><Label className="text-white/60 text-xs">Apt / suite (optional)</Label><Input value={form.street2} onChange={set("street2")} className="bg-black/40 border-white/10" /></div>
              <div><Label className="text-white/60 text-xs">City</Label><Input value={form.city} onChange={set("city")} className="bg-black/40 border-white/10" /></div>
              <div><Label className="text-white/60 text-xs">State</Label><Input value={form.state_code} onChange={set("state_code")} className="bg-black/40 border-white/10" /></div>
              <div><Label className="text-white/60 text-xs">Postal code</Label><Input value={form.postcode} onChange={set("postcode")} className="bg-black/40 border-white/10" /></div>
              <div><Label className="text-white/60 text-xs">Country</Label><Input value={form.country_code} onChange={set("country_code")} maxLength={2} className="bg-black/40 border-white/10" /></div>
              <div className="col-span-2"><Label className="text-white/60 text-xs">Phone</Label><Input value={form.phone_number} onChange={set("phone_number")} className="bg-black/40 border-white/10" /></div>
              <div className="col-span-2"><Label className="text-white/60 text-xs">Email (order updates)</Label><Input type="email" value={form.contactEmail} onChange={set("contactEmail")} className="bg-black/40 border-white/10" /></div>
            </div>
            <Button onClick={getQuote} disabled={quoting} className="w-full bg-[#C9A84C] text-black hover:bg-[#b8963e] font-bold">
              {quoting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Get print quote
            </Button>
          </div>
        )}

        {step === "quote" && quote && (
          <div className="space-y-4">
            <div className="rounded-lg border border-white/10 bg-black/40 p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-white/60">{quote.quantity} × 6"×9" paperback ({quote.pageCount} pages)</span><span className="text-white font-bold">${quote.printCostUsd.toFixed(2)}</span></div>
              <div>
                <Label className="text-white/60 text-xs">Shipping</Label>
                <div className="space-y-1 mt-1">
                  {quote.shippingOptions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setShippingLevel(s.id)}
                      className={`w-full flex justify-between px-3 py-2 rounded-lg text-sm border ${shippingLevel === s.id ? "border-[#C9A84C] text-white" : "border-white/10 text-white/60"}`}
                    >
                      <span>{s.label}{s.deliveryEstimate ? ` · ${s.deliveryEstimate}` : ""}</span>
                      <span className="font-bold">${s.costUsd.toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-between pt-2 border-t border-white/10">
                <span className="text-white/60">Total</span>
                <span className="text-[#C9A84C] font-black text-lg">{totalVb.toLocaleString()} VB <span className="text-white/40 text-xs font-normal">(${totalUsd.toFixed(2)})</span></span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setStep("form")} variant="outline" className="border-white/20 text-white/70">Back</Button>
              <Button onClick={placeOrder} disabled={ordering} className="flex-1 bg-[#C9A84C] text-black hover:bg-[#b8963e] font-bold">
                {ordering ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Package className="h-4 w-4 mr-2" />}
                Confirm order — {totalVb.toLocaleString()} VB
              </Button>
            </div>
            <p className="text-white/40 text-xs">Charged in Visual Bucs now. Lulu prints and ships directly to the address above.</p>
          </div>
        )}

        {step === "done" && orderResult && (
          <div className="text-center space-y-3 py-4">
            <Check className="h-12 w-12 mx-auto text-[#C9A84C]" />
            <h3 className="text-white font-bold text-lg">Order placed!</h3>
            <p className="text-white/60 text-sm">Your book is heading to the printer. Track it any time from your orders.</p>
            <Button onClick={onClose} className="bg-[#C9A84C] text-black hover:bg-[#b8963e] font-bold">Done</Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── AI writing assistance panel ── */

function AiAssistPanel({
  book, chapter, chapterContent, onInsert,
}: {
  book: Book;
  chapter: Chapter | null;
  chapterContent: string;
  onInsert: (text: string) => void;
}) {
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const [instruction, setInstruction] = useState("");
  const [running, setRunning] = useState<AssistAction | null>(null);
  const [result, setResult] = useState<{ action: AssistAction; text: string } | null>(null);

  const runAssist = async (action: AssistAction) => {
    const needsChapter = ASSIST_ACTIONS.find((a) => a.id === action)?.chapterOnly;
    if (needsChapter && !chapter) {
      toast({ title: "Select a chapter first", variant: "destructive" });
      return;
    }
    setRunning(action);
    setResult(null);
    try {
      const res = await confirmedFetch("/api/books/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: book.id,
          chapterId: chapter?.id,
          action,
          text: needsChapter ? chapterContent : (book.description ?? ""),
          instruction,
        }),
        /* 100 VB per assist — show the standard confirm. */
        overrideCost: 100,
        overrideFeature: "Thy Books AI Writing Assist",
      });
      if (!res) return; /* user cancelled */
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error ?? "AI assist failed", variant: "destructive" });
        return;
      }
      setResult({ action, text: data.result });
    } catch {
      toast({ title: "AI assist failed", variant: "destructive" });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="w-80 shrink-0 border-l border-white/10 p-4 overflow-y-auto bg-white/[0.01]">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="h-4 w-4 text-[#C9A84C]" />
        <p className="text-sm font-bold text-[#C9A84C]">AI Ghostwriter</p>
      </div>
      <p className="text-white/30 text-xs mb-4">100 Visual Bucs per assist</p>

      <Textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="Optional instruction — e.g. 'make it funnier', 'more tension'…"
        rows={2}
        className="bg-white/5 border-white/10 text-sm mb-3"
      />

      <div className="grid grid-cols-2 gap-2 mb-4">
        {ASSIST_ACTIONS.map((a) => (
          <Button
            key={a.id}
            onClick={() => runAssist(a.id)}
            disabled={running !== null}
            variant="outline"
            size="sm"
            className="border-white/10 text-white/70 hover:border-[#C9A84C]/50 hover:text-[#C9A84C] text-xs justify-start"
          >
            {running === a.id ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <a.icon className="h-3.5 w-3.5 mr-1.5" />}
            {a.label}
          </Button>
        ))}
      </div>

      {result && (
        <div className="border border-[#C9A84C]/30 rounded-xl p-3 bg-[#C9A84C]/[0.04]">
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb className="h-3.5 w-3.5 text-[#C9A84C]" />
            <p className="text-xs font-bold text-[#C9A84C] capitalize">{result.action.replace("-", " ")}</p>
          </div>
          <p className="text-white/80 text-sm whitespace-pre-wrap max-h-96 overflow-y-auto" style={{ fontFamily: "Georgia, serif" }}>
            {result.text}
          </p>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              onClick={() => { onInsert(result.text); toast({ title: "Inserted into chapter" }); }}
              className="bg-[#C9A84C] text-black text-xs font-bold flex-1"
              disabled={!chapter || ["outline", "title-ideas", "blurb"].includes(result.action)}
            >
              Insert into chapter
            </Button>
            <Button size="sm" variant="outline" onClick={() => setResult(null)} className="text-xs border-white/10">
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {!result && !running && (
        <p className="text-white/25 text-xs leading-relaxed">
          Pick an action above. "Continue writing" picks up where your chapter leaves off.
          Outlines, titles, and blurbs work from your book description.
        </p>
      )}
    </div>
  );
}

function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return text.trim() ? words.length : 0;
}
