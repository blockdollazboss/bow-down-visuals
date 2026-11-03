import { useEffect, useState } from "react";
import {
  ArrowLeft, BookOpen, Check, Download, Image as ImageIcon, Loader2, Package,
  PenLine, Plus, Printer, Sparkles, Trash2,
} from "lucide-react";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { NativeCard } from "@/components/world/native/NativeCard";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native/NativeStates";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
import {
  BOOKS_PATH,
  BOOK_AI_ASSIST_COST_VB,
  BOOK_AI_ASSIST_FEATURE,
  BOOK_COVER_COST_VB,
  BOOK_COVER_FEATURE,
  BOOK_PRINT_COLORS,
  BOOK_PRINT_ORDERS_PATH,
  EMPTY_BOOK_FORM,
  EMPTY_PRINT_ADDRESS,
  assistActionChapterOnly,
  assistResultInsertable,
  bookChapterPath,
  bookChaptersPath,
  bookCoverPath,
  bookExportPath,
  bookExportReady,
  bookFormFromSummary,
  bookFormReady,
  bookPath,
  bookPrintOrderCancelPath,
  bookPrintOrderPath,
  bookPrintOrderStatusPath,
  bookPrintQuotePath,
  buildAssistBody,
  buildBookBody,
  buildChapterContentBody,
  buildChapterCreateBody,
  buildChapterTitleBody,
  buildCoverBody,
  buildPrintOrderBody,
  buildPrintQuoteBody,
  chapterTitleReady,
  countBookWords,
  normalizeAssistResult,
  normalizeBookDetail,
  normalizeBooks,
  normalizeCoverResult,
  normalizeCreatedChapter,
  normalizePrintOrderPlaced,
  normalizePrintOrders,
  normalizePrintQuote,
  printAddressReady,
  printQuantityReady,
  printTotalVb,
  totalBookWords,
  BOOK_ASSIST_ACTIONS,
  type BookAssistAction,
  type BookChapter,
  type BookDetail,
  type BookForm,
  type BookPrintAddressForm,
  type BookPrintOrder,
  type BookPrintQuote,
  type BookSummary,
} from "@/lib/world/books-desk";

/* ─── Thy Books, in-world (stack1400 world parity wave 2) ──────────
   The whole books product line at My Studio, on the books router's
   own rails — the same endpoints pages/books.tsx calls: write
   (book + chapter CRUD, free), design (AI cover, 200 Bucs,
   registry-pinned, confirmed before the charge), the AI ghostwriter
   (100 Bucs per assist, registry-pinned, confirmed), publish outputs
   (EPUB + print-ready PDF export, free, armed at ≥1 chapter) and
   print-on-demand (the SERVER quotes the Visual Buc price; the desk
   names that quote in the confirmation and never invents one).
   Print orders list, refresh their status from the printer, and
   cancel before production — all in the room.

   NAMED GAP (verbatim from the census/scope check): the books rails
   carry no publish/list state — a book has no status field and there
   is no POST publish endpoint for books; the 2D page's "Publish &
   Sell" button is a link out to /storefronts?title=…, not a books
   rail. World law forbids the exit, so the desk does NOT fake a
   publish button: export + print are the publish outputs the rails
   support, and selling a finished book stays on the shop stands'
   own product rails, not a books-desk charge.

   Every books rail is requireAuth — members only, exactly the 2D
   feature's boundary; a guest's reads fail honestly below instead
   of dressing up as an empty shelf. Deletes are two-step, spoken
   in-world — the house pattern for destructive verbs. */

const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;

export function BooksDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const errCls = isLight ? "text-[#8a2f1b]" : "text-red-300";

  const [books, setBooks] = useState<BookSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* Create */
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<BookForm>(EMPTY_BOOK_FORM);
  const [creating, setCreating] = useState(false);

  /* Detail / editor */
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [editForm, setEditForm] = useState<BookForm>(EMPTY_BOOK_FORM);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDeleteBook, setConfirmDeleteBook] = useState(false);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [chapterTitleDraft, setChapterTitleDraft] = useState("");
  const [newChapterTitle, setNewChapterTitle] = useState("");
  const [confirmDeleteChapterId, setConfirmDeleteChapterId] = useState<string | null>(null);

  /* AI ghostwriter */
  const [instruction, setInstruction] = useState("");
  const [assistRunning, setAssistRunning] = useState<BookAssistAction | null>(null);
  const [assistResult, setAssistResult] = useState<{ action: BookAssistAction; text: string } | null>(null);

  /* Cover */
  const [coverStyle, setCoverStyle] = useState("");
  const [coverBusy, setCoverBusy] = useState(false);

  /* Export */
  const [exporting, setExporting] = useState<"epub" | "pdf" | null>(null);

  /* Print */
  const [showPrint, setShowPrint] = useState(false);
  const [printForm, setPrintForm] = useState<BookPrintAddressForm>(EMPTY_PRINT_ADDRESS);
  const [quantity, setQuantity] = useState(1);
  const [color, setColor] = useState<string>("bw");
  const [quote, setQuote] = useState<BookPrintQuote | null>(null);
  const [shippingLevel, setShippingLevel] = useState("MAIL");
  const [printBusy, setPrintBusy] = useState<string | null>(null);
  const [orders, setOrders] = useState<BookPrintOrder[] | null>(null);
  const [confirmCancelOrderId, setConfirmCancelOrderId] = useState<string | null>(null);

  const activeChapter: BookChapter | null =
    detail?.chapters.find((c) => c.id === activeChapterId) ?? null;

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    (async () => {
      try {
        const res = await fetch(BOOKS_PATH, { headers: await authHeaders() });
        if (!res.ok) throw new Error(`books ${res.status}`);
        const parsed = normalizeBooks(await res.json());
        if (!parsed) throw new Error("books shape");
        if (!cancelled) setBooks(parsed);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  /* Print orders ride along quietly — their failure never takes the
     bookshelf down (the section just stays hidden). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(BOOK_PRINT_ORDERS_PATH, { headers: await authHeaders() });
        if (!res.ok) return;
        const parsed = normalizePrintOrders(await res.json());
        if (!cancelled && parsed) setOrders(parsed);
      } catch {
        /* tolerant — the orders strip reads absent */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  function selectChapter(ch: BookChapter) {
    setActiveChapterId(ch.id);
    setContent(ch.content);
    setChapterTitleDraft(ch.title);
    setConfirmDeleteChapterId(null);
  }

  async function openBook(id: string) {
    setOpenId(id);
    setDetail(null);
    setDetailFailed(false);
    setError(null);
    setNote(null);
    setConfirmDeleteBook(false);
    setAssistResult(null);
    setQuote(null);
    setShowPrint(false);
    try {
      const res = await fetch(bookPath(id), { headers: await authHeaders() });
      if (!res.ok) throw new Error(`book ${res.status}`);
      const parsed = normalizeBookDetail(await res.json());
      if (!parsed) throw new Error("book shape");
      setDetail(parsed);
      setEditForm(bookFormFromSummary(parsed.book));
      const first = parsed.chapters[0];
      if (first) {
        setActiveChapterId(first.id);
        setContent(first.content);
        setChapterTitleDraft(first.title);
      } else {
        setActiveChapterId(null);
        setContent("");
        setChapterTitleDraft("");
      }
    } catch {
      setDetailFailed(true);
    }
  }

  async function create() {
    if (!bookFormReady(createForm) || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(BOOKS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildBookBody(createForm)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't create the book (${res.status})`));
      const made = normalizeBookDetail({ book: data["book"], chapters: [] });
      setCreateForm(EMPTY_BOOK_FORM);
      setShowCreate(false);
      setTick((t) => t + 1);
      if (made) {
        setNote(`“${made.book.title}” is started — add a chapter and write.`);
        void openBook(made.book.id);
      } else {
        setNote("Book started.");
      }
    } catch (err) {
      setError(plainErrorText(err, "Couldn't create the book — try again."));
    } finally {
      setCreating(false);
    }
  }

  async function saveBookFields() {
    if (!detail || !bookFormReady(editForm)) return;
    setBusy("save-book");
    setError(null);
    try {
      const res = await fetch(bookPath(detail.book.id), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildBookBody(editForm)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't save the book (${res.status})`));
      setDetail({
        ...detail,
        book: {
          ...detail.book,
          title: editForm.title.trim(),
          subtitle: editForm.subtitle.trim() || null,
          authorName: editForm.authorName.trim() || null,
          genre: editForm.genre.trim() || null,
          description: editForm.description.trim() || null,
        },
      });
      setNote("Saved.");
      setTick((t) => t + 1);
    } catch (err) {
      setError(plainErrorText(err, "Couldn't save — try again."));
    } finally {
      setBusy(null);
    }
  }

  async function removeBook() {
    if (!detail) return;
    if (!confirmDeleteBook) {
      setConfirmDeleteBook(true);
      return;
    }
    setBusy("delete-book");
    setError(null);
    try {
      const res = await fetch(bookPath(detail.book.id), {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't delete (${res.status})`));
      setOpenId(null);
      setDetail(null);
      setConfirmDeleteBook(false);
      setNote("Book deleted, chapters with it.");
      setTick((t) => t + 1);
    } catch (err) {
      setError(plainErrorText(err, "Couldn't delete — try again."));
    } finally {
      setBusy(null);
    }
  }

  async function addChapter() {
    if (!detail || busy) return;
    const title = newChapterTitle.trim() || `Chapter ${detail.chapters.length + 1}`;
    if (!chapterTitleReady(title)) return;
    setBusy("add-chapter");
    setError(null);
    try {
      const res = await fetch(bookChaptersPath(detail.book.id), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildChapterCreateBody(title)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't add the chapter (${res.status})`));
      const ch = normalizeCreatedChapter(data);
      if (!ch) throw new Error("chapter shape");
      setDetail({ ...detail, chapters: [...detail.chapters, ch] });
      setNewChapterTitle("");
      selectChapter(ch);
      setNote("Chapter added.");
    } catch (err) {
      setError(plainErrorText(err, "Couldn't add the chapter — try again."));
    } finally {
      setBusy(null);
    }
  }

  async function saveChapterContent() {
    if (!detail || !activeChapter || busy) return;
    setBusy("save-chapter");
    setError(null);
    try {
      const res = await fetch(bookChapterPath(detail.book.id, activeChapter.id), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildChapterContentBody(content)),
      });
      const data = (await res.json().catch(() => ({}))) as { wordCount?: unknown };
      if (!res.ok) throw new Error(apiErrorMessage(data as Record<string, unknown>, `Couldn't save the chapter (${res.status})`));
      const wc = typeof data.wordCount === "number" ? data.wordCount : countBookWords(content);
      setDetail({
        ...detail,
        chapters: detail.chapters.map((c) =>
          c.id === activeChapter.id ? { ...c, content, wordCount: wc } : c,
        ),
      });
      setNote("Chapter saved.");
    } catch (err) {
      setError(plainErrorText(err, "Couldn't save the chapter — try again."));
    } finally {
      setBusy(null);
    }
  }

  async function saveChapterTitle() {
    if (!detail || !activeChapter || !chapterTitleReady(chapterTitleDraft) || busy) return;
    setBusy("save-chapter-title");
    setError(null);
    try {
      const res = await fetch(bookChapterPath(detail.book.id, activeChapter.id), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildChapterTitleBody(chapterTitleDraft)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't rename the chapter (${res.status})`));
      setDetail({
        ...detail,
        chapters: detail.chapters.map((c) =>
          c.id === activeChapter.id ? { ...c, title: chapterTitleDraft.trim() } : c,
        ),
      });
    } catch (err) {
      setError(plainErrorText(err, "Couldn't rename the chapter — try again."));
    } finally {
      setBusy(null);
    }
  }

  async function removeChapter(ch: BookChapter) {
    if (!detail || busy) return;
    if (confirmDeleteChapterId !== ch.id) {
      setConfirmDeleteChapterId(ch.id);
      return;
    }
    setBusy("delete-chapter");
    setError(null);
    try {
      const res = await fetch(bookChapterPath(detail.book.id, ch.id), {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't delete the chapter (${res.status})`));
      const rest = detail.chapters.filter((c) => c.id !== ch.id);
      setDetail({ ...detail, chapters: rest });
      setConfirmDeleteChapterId(null);
      if (activeChapterId === ch.id) {
        const next = rest[0];
        if (next) selectChapter(next);
        else {
          setActiveChapterId(null);
          setContent("");
          setChapterTitleDraft("");
        }
      }
      setNote("Chapter deleted.");
    } catch (err) {
      setError(plainErrorText(err, "Couldn't delete the chapter — try again."));
    } finally {
      setBusy(null);
    }
  }

  async function runAssist(action: BookAssistAction) {
    if (!detail || assistRunning) return;
    const needsChapter = assistActionChapterOnly(action);
    if (needsChapter && !activeChapter) {
      setError("Pick a chapter first — that assist works on chapter text.");
      return;
    }
    setAssistRunning(action);
    setAssistResult(null);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(BOOK_AI_ASSIST_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(
          buildAssistBody({
            bookId: detail.book.id,
            chapterId: activeChapter?.id ?? null,
            action,
            text: needsChapter ? content : (detail.book.description ?? ""),
            instruction,
          }),
        ),
        overrideCost: BOOK_AI_ASSIST_COST_VB,
        overrideFeature: BOOK_AI_ASSIST_FEATURE,
      });
      if (!res) return; // declined the confirmation — nothing charged
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) throw new Error(apiErrorMessage(data, `The ghostwriter stumbled (${res.status})`));
      const text = normalizeAssistResult(data);
      if (!text) throw new Error("assist shape");
      setAssistResult({ action, text });
    } catch (err) {
      setError(plainErrorText(err, "The ghostwriter stumbled — a failed assist is refunded by the rail; try again."));
    } finally {
      setAssistRunning(null);
    }
  }

  function insertAssistResult() {
    if (!assistResult || !assistResultInsertable(assistResult.action)) return;
    setContent(content ? `${content}\n\n${assistResult.text}` : assistResult.text);
    setNote("Inserted into the chapter — Save chapter to keep it.");
  }

  async function generateCover() {
    if (!detail || coverBusy) return;
    setCoverBusy(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(bookCoverPath(detail.book.id), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildCoverBody(coverStyle)),
        overrideCost: BOOK_COVER_COST_VB,
        overrideFeature: BOOK_COVER_FEATURE,
      });
      if (!res) return; // declined the confirmation — nothing charged
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) throw new Error(apiErrorMessage(data, `Cover generation failed (${res.status})`));
      const url = normalizeCoverResult(data);
      if (!url) throw new Error("cover shape");
      setDetail({ ...detail, book: { ...detail.book, coverUrl: url } });
      setNote("Cover generated — it leads the book everywhere it shows.");
      setTick((t) => t + 1);
    } catch (err) {
      setError(plainErrorText(err, "Cover generation failed — a failed cover is refunded by the rail; try again."));
    } finally {
      setCoverBusy(false);
    }
  }

  async function exportBook(format: "epub" | "pdf") {
    if (!detail || exporting) return;
    setExporting(format);
    setError(null);
    try {
      const res = await fetch(bookExportPath(detail.book.id, format), {
        headers: await authHeaders(),
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(apiErrorMessage(data, `Export failed (${res.status})`));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${detail.book.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNote(`${format.toUpperCase()} exported — the file is yours, downloaded right here.`);
    } catch (err) {
      setError(plainErrorText(err, "Export failed — try again."));
    } finally {
      setExporting(null);
    }
  }

  async function getPrintQuote() {
    if (!detail || printBusy) return;
    if (!printAddressReady(printForm) || !printQuantityReady(quantity)) {
      setError("Fill in the shipping details first — name, street, city, postcode, phone, and an email for order updates.");
      return;
    }
    setPrintBusy("quote");
    setError(null);
    try {
      const res = await confirmedFetch(bookPrintQuotePath(detail.book.id), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildPrintQuoteBody({ form: printForm, quantity, color })),
        skipConfirm: true,
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Quote failed (${res.status})`));
      const parsed = normalizePrintQuote(data);
      if (!parsed) throw new Error("quote shape");
      setQuote(parsed);
      if (parsed.shippingOptions.length > 0 && !parsed.shippingOptions.some((s) => s.id === shippingLevel)) {
        setShippingLevel(parsed.shippingOptions[0].id);
      }
    } catch (err) {
      setError(plainErrorText(err, "Quote failed — print-on-demand may not be configured yet, or the printer didn't answer."));
    } finally {
      setPrintBusy(null);
    }
  }

  async function placePrintOrder() {
    if (!detail || !quote || printBusy) return;
    const chosen = quote.shippingOptions.find((s) => s.id === shippingLevel);
    const totalVb = printTotalVb(quote, chosen?.costUsd ?? 0);
    setPrintBusy("order");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(bookPrintOrderPath(detail.book.id), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildPrintOrderBody({ form: printForm, shippingLevel, quantity, color })),
        overrideCost: totalVb,
        overrideFeature: "Print a book (print-on-demand)",
      });
      if (!res) return; // declined the confirmation — nothing charged
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) throw new Error(apiErrorMessage(data, `Order failed (${res.status})`));
      const placed = normalizePrintOrderPlaced(data);
      setQuote(null);
      setNote(
        placed
          ? `Print order placed — ${placed.priceVb.toLocaleString("en-US")} Bucs. Track it in your print orders below.`
          : "Print order placed. Track it in your print orders below.",
      );
      setTick((t) => t + 1);
    } catch (err) {
      setError(plainErrorText(err, "Order failed — try again."));
    } finally {
      setPrintBusy(null);
    }
  }

  async function refreshOrderStatus(order: BookPrintOrder) {
    setPrintBusy(`status-${order.id}`);
    setError(null);
    try {
      const res = await fetch(bookPrintOrderStatusPath(order.id), { headers: await authHeaders() });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Status check failed (${res.status})`));
      const status = typeof data["status"] === "string" ? data["status"] : order.status;
      setOrders((os) => (os ?? []).map((o) => (o.id === order.id ? { ...o, status } : o)));
    } catch (err) {
      setError(plainErrorText(err, "Status check failed — try again."));
    } finally {
      setPrintBusy(null);
    }
  }

  async function cancelOrder(order: BookPrintOrder) {
    if (confirmCancelOrderId !== order.id) {
      setConfirmCancelOrderId(order.id);
      return;
    }
    setPrintBusy(`cancel-${order.id}`);
    setError(null);
    try {
      const res = await fetch(bookPrintOrderCancelPath(order.id), {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Cancel failed (${res.status})`));
      setConfirmCancelOrderId(null);
      setOrders((os) => (os ?? []).map((o) => (o.id === order.id ? { ...o, status: "canceled" } : o)));
      setNote("Print order canceled.");
    } catch (err) {
      setError(plainErrorText(err, "Cancel failed — the order may already be in production."));
    } finally {
      setPrintBusy(null);
    }
  }

  const bookFields = (form: BookForm, setForm: (f: BookForm) => void, prefix: string) => (
    <div className="space-y-2">
      <input
        className={deskInputCls(isLight)}
        placeholder="Title *"
        maxLength={200}
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        aria-label={`${prefix} title`}
      />
      <div className="flex flex-wrap gap-2">
        <input
          className={deskInputCls(isLight)}
          placeholder="Author name"
          maxLength={200}
          value={form.authorName}
          onChange={(e) => setForm({ ...form, authorName: e.target.value })}
          aria-label={`${prefix} author name`}
        />
        <input
          className={deskInputCls(isLight)}
          placeholder="Subtitle (optional)"
          maxLength={200}
          value={form.subtitle}
          onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
          aria-label={`${prefix} subtitle`}
        />
        <input
          className={deskInputCls(isLight)}
          placeholder="Genre"
          maxLength={100}
          value={form.genre}
          onChange={(e) => setForm({ ...form, genre: e.target.value })}
          aria-label={`${prefix} genre`}
        />
      </div>
      <textarea
        className={deskInputCls(isLight)}
        placeholder="What is this book about? The ghostwriter works from this."
        rows={2}
        maxLength={2000}
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        aria-label={`${prefix} description`}
      />
    </div>
  );

  const printOrdersStrip = orders && orders.length > 0 ? (
    <div className="space-y-1.5" data-testid="world-books-print-orders">
      <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>Your print orders</p>
      {orders.slice(0, 10).map((o) => (
        <div
          key={o.id}
          className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
            isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
          }`}
        >
          <Package className="h-4 w-4 text-[#d4af37]" />
          <span className={`text-xs font-bold ${strong}`}>
            {o.quantity} × · {o.pageCount} pages · {o.status}
            {o.amountCents > 0 ? ` · $${(o.amountCents / 100).toFixed(2)}` : ""}
          </span>
          <button type="button" className={chipBtn(isLight)} disabled={printBusy !== null} onClick={() => void refreshOrderStatus(o)}>
            {printBusy === `status-${o.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Refresh status
          </button>
          {o.status !== "canceled" ? (
            <button
              type="button"
              className={confirmCancelOrderId === o.id ? goldBtn : chipBtn(isLight)}
              disabled={printBusy !== null}
              onClick={() => void cancelOrder(o)}
            >
              {confirmCancelOrderId === o.id ? "Tap again to cancel the order" : "Cancel"}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  ) : null;

  return (
    <NativeCard isLight={isLight} title="Thy Books — write, design, publish">
      <div data-testid="world-books-desk" className="space-y-3">
        {error ? <p className={`text-xs ${errCls}`}>{error}</p> : null}
        {note ? <p className={`text-xs font-semibold ${strong}`}>{note}</p> : null}
        {outOfCredits ? (
          <p className={`text-xs font-semibold ${strong}`}>
            Not enough Visual Bucs for that — nothing was charged. Top up at the Treasury and try again.
          </p>
        ) : null}

        {openId === null ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={`text-sm ${muted}`}>
                Your books, written right here. Drafting is free; the ghostwriter costs{" "}
                {BOOK_AI_ASSIST_COST_VB} Bucs a turn and a cover {BOOK_COVER_COST_VB} Bucs — both
                named again before anything charges.
              </p>
              <button type="button" className={goldBtn} onClick={() => setShowCreate((s) => !s)} aria-expanded={showCreate}>
                <Plus className="h-3.5 w-3.5" /> New book
              </button>
            </div>

            {showCreate ? (
              <div data-testid="world-books-create" className="space-y-2">
                {bookFields(createForm, setCreateForm, "New book")}
                <button
                  type="button"
                  className={goldBtn}
                  disabled={!bookFormReady(createForm) || creating}
                  onClick={() => void create()}
                >
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Start the book — free
                </button>
              </div>
            ) : null}

            {loadFailed ? (
              <NativeErrorState
                isLight={isLight}
                title="Your books wouldn't open"
                message="A failed load is not an empty shelf — your books are safe on the real rails. Members only: if you're visiting as a guest, sign in and your shelf stands here."
                onRetry={() => setTick((t) => t + 1)}
              />
            ) : books === null ? (
              <NativeLoadingState isLight={isLight} message="Reading your bookshelf…" />
            ) : books.length === 0 ? (
              <NativeEmptyState
                isLight={isLight}
                message="No books yet."
                detail="Start your first above — the ghostwriter helps you write every chapter."
              />
            ) : (
              books.map((b) => (
                <div
                  key={b.id}
                  className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                    isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                  }`}
                >
                  {b.coverUrl ? (
                    <img src={b.coverUrl} alt="" className="h-10 w-7 rounded object-cover" />
                  ) : (
                    <BookOpen className="h-4 w-4 text-[#d4af37]" />
                  )}
                  <span className={`text-sm font-bold ${strong}`}>{b.title}</span>
                  <span className={`text-xs ${muted}`}>
                    {[b.genre, b.authorName].filter(Boolean).join(" · ")}
                  </span>
                  <button type="button" className={chipBtn(isLight)} onClick={() => void openBook(b.id)}>
                    Open
                  </button>
                </div>
              ))
            )}
            {printOrdersStrip}
          </>
        ) : detailFailed ? (
          <div className="space-y-2">
            <button type="button" className={chipBtn(isLight)} onClick={() => setOpenId(null)}>
              <ArrowLeft className="h-3.5 w-3.5" /> All books
            </button>
            <NativeErrorState
              isLight={isLight}
              title="That book wouldn't open"
              message="The book is safe — it just didn't answer. Try again."
              onRetry={() => openId && void openBook(openId)}
            />
          </div>
        ) : detail === null ? (
          <NativeLoadingState isLight={isLight} message="Opening the book…" />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={chipBtn(isLight)} onClick={() => setOpenId(null)}>
                <ArrowLeft className="h-3.5 w-3.5" /> All books
              </button>
              <span className={`text-sm font-black ${strong}`}>{detail.book.title}</span>
              <span className={`text-xs ${muted}`}>
                {detail.chapters.length} chapter{detail.chapters.length === 1 ? "" : "s"} ·{" "}
                {totalBookWords(detail.chapters, activeChapterId, content).toLocaleString("en-US")} words
              </span>
            </div>

            {/* Book fields */}
            {bookFields(editForm, setEditForm, "Book")}
            <button
              type="button"
              className={chipBtn(isLight)}
              disabled={!bookFormReady(editForm) || busy !== null}
              onClick={() => void saveBookFields()}
            >
              {busy === "save-book" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save the book&rsquo;s words — free
            </button>

            {/* Chapters */}
            <div className="space-y-1.5">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>Chapters</p>
              {detail.chapters.length === 0 ? (
                <NativeEmptyState
                  isLight={isLight}
                  message="No chapters yet."
                  detail="Add one below to start writing — exports arm once the book has a chapter."
                />
              ) : (
                detail.chapters.map((c, i) => (
                  <div
                    key={c.id}
                    className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 ${
                      c.id === activeChapterId
                        ? isLight
                          ? "border-[#d4af37] bg-[#C9A84C]/15"
                          : "border-[#d4af37]/60 bg-[#C9A84C]/10"
                        : isLight
                          ? "border-[#C9A84C]/40 bg-white/50"
                          : "border-white/10 bg-white/5"
                    }`}
                  >
                    <span className={`w-5 text-xs font-black ${muted}`}>{i + 1}</span>
                    <button
                      type="button"
                      className={`flex-1 text-left text-sm bdv-touch-target ${strong}`}
                      onClick={() => selectChapter(c)}
                    >
                      {c.title}
                      <span className={`ml-2 text-xs ${muted}`}>{c.wordCount.toLocaleString("en-US")} words</span>
                    </button>
                    <button
                      type="button"
                      className={confirmDeleteChapterId === c.id ? goldBtn : chipBtn(isLight)}
                      disabled={busy !== null}
                      onClick={() => void removeChapter(c)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {confirmDeleteChapterId === c.id ? "Tap again to delete" : ""}
                    </button>
                  </div>
                ))
              )}
              <div className="flex gap-2">
                <input
                  className={deskInputCls(isLight)}
                  placeholder="New chapter title"
                  maxLength={200}
                  value={newChapterTitle}
                  onChange={(e) => setNewChapterTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void addChapter()}
                  aria-label="New chapter title"
                />
                <button type="button" className={goldBtn} disabled={busy !== null} onClick={() => void addChapter()}>
                  {busy === "add-chapter" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Add chapter
                </button>
              </div>
            </div>

            {/* Chapter editor */}
            {activeChapter ? (
              <div className="space-y-2" data-testid="world-books-chapter-editor">
                <div className="flex gap-2">
                  <input
                    className={deskInputCls(isLight)}
                    value={chapterTitleDraft}
                    maxLength={200}
                    onChange={(e) => setChapterTitleDraft(e.target.value)}
                    onBlur={() => void saveChapterTitle()}
                    aria-label="Chapter title"
                  />
                </div>
                <textarea
                  className={deskInputCls(isLight)}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Start writing… or ask the ghostwriter below."
                  rows={10}
                  aria-label="Chapter text"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs ${muted}`}>{countBookWords(content).toLocaleString("en-US")} words in this chapter</span>
                  <button type="button" className={goldBtn} disabled={busy !== null} onClick={() => void saveChapterContent()}>
                    {busy === "save-chapter" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Save chapter
                  </button>
                </div>
              </div>
            ) : null}

            {/* AI ghostwriter */}
            <div className="space-y-2" data-testid="world-books-assist">
              <p className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.12em] ${muted}`}>
                <Sparkles className="h-3.5 w-3.5 text-[#d4af37]" /> AI ghostwriter — {BOOK_AI_ASSIST_COST_VB} Bucs per assist
              </p>
              <input
                className={deskInputCls(isLight)}
                placeholder="Optional instruction — e.g. 'make it funnier', 'more tension'…"
                maxLength={2000}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                aria-label="Ghostwriter instruction"
              />
              <div className="flex flex-wrap gap-2">
                {BOOK_ASSIST_ACTIONS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={chipBtn(isLight)}
                    disabled={assistRunning !== null || (a.chapterOnly && !activeChapter)}
                    onClick={() => void runAssist(a.id)}
                  >
                    {assistRunning === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />}
                    {a.label}
                  </button>
                ))}
              </div>
              {assistResult ? (
                <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-[#C9A84C]/30 bg-white/5"}`}>
                  <p className={`whitespace-pre-wrap text-sm ${strong}`}>{assistResult.text}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {assistResultInsertable(assistResult.action) && activeChapter ? (
                      <button type="button" className={goldBtn} onClick={insertAssistResult}>
                        Insert into chapter
                      </button>
                    ) : null}
                    <button type="button" className={chipBtn(isLight)} onClick={() => setAssistResult(null)}>
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Cover */}
            <div className="space-y-2" data-testid="world-books-cover">
              <p className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.12em] ${muted}`}>
                <ImageIcon className="h-3.5 w-3.5 text-[#d4af37]" /> Cover — {BOOK_COVER_COST_VB} Bucs
              </p>
              {detail.book.coverUrl ? (
                <img src={detail.book.coverUrl} alt={`Cover of ${detail.book.title}`} className="h-36 w-24 rounded-lg object-cover" />
              ) : (
                <p className={`text-xs ${muted}`}>No cover yet — generate one and it leads the book everywhere it shows.</p>
              )}
              <div className="flex gap-2">
                <input
                  className={deskInputCls(isLight)}
                  placeholder="Style (optional) — e.g. watercolor, noir, minimal"
                  maxLength={200}
                  value={coverStyle}
                  onChange={(e) => setCoverStyle(e.target.value)}
                  aria-label="Cover style"
                />
                <button type="button" className={goldBtn} disabled={coverBusy} onClick={() => void generateCover()}>
                  {coverBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  {detail.book.coverUrl ? "New cover" : "Generate cover"} — {BOOK_COVER_COST_VB} Bucs
                </button>
              </div>
            </div>

            {/* Publish outputs: export + print */}
            <div className="space-y-2" data-testid="world-books-publish">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>Publish outputs</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={chipBtn(isLight)}
                  disabled={!bookExportReady(detail.chapters.length) || exporting !== null}
                  onClick={() => void exportBook("epub")}
                >
                  {exporting === "epub" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  EPUB — free
                </button>
                <button
                  type="button"
                  className={chipBtn(isLight)}
                  disabled={!bookExportReady(detail.chapters.length) || exporting !== null}
                  onClick={() => void exportBook("pdf")}
                >
                  {exporting === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Print-ready PDF — free
                </button>
                <button
                  type="button"
                  className={chipBtn(isLight)}
                  disabled={!bookExportReady(detail.chapters.length)}
                  onClick={() => setShowPrint((s) => !s)}
                  aria-expanded={showPrint}
                >
                  <Printer className="h-3.5 w-3.5" /> Print a paperback
                </button>
                <button
                  type="button"
                  className={confirmDeleteBook ? goldBtn : chipBtn(isLight)}
                  disabled={busy !== null}
                  onClick={() => void removeBook()}
                >
                  {busy === "delete-book" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  {confirmDeleteBook ? "Tap again to delete for good" : "Delete book"}
                </button>
              </div>
              {!bookExportReady(detail.chapters.length) ? (
                <p className={`text-xs ${muted}`}>Add at least one chapter and the export + print buttons arm.</p>
              ) : null}

              {showPrint ? (
                <div className="space-y-2" data-testid="world-books-print">
                  <p className={`text-xs ${muted}`}>
                    6″×9″ paperback, printed on demand and shipped to you. The printer quotes the price —
                    the desk shows the server&rsquo;s own Visual Buc number before anything charges.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <label className={`flex items-center gap-2 text-xs font-bold ${strong}`}>
                      Copies
                      <input
                        type="number"
                        min={1}
                        max={100}
                        className={deskInputCls(isLight)}
                        value={quantity}
                        onChange={(e) => setQuantity(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                        aria-label="Print copies"
                      />
                    </label>
                    <div className="flex gap-2" role="group" aria-label="Print interior">
                      {BOOK_PRINT_COLORS.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          className={color === c.key ? goldBtn : chipBtn(isLight)}
                          onClick={() => setColor(c.key)}
                          aria-pressed={color === c.key}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        ["name", "Full name"],
                        ["street1", "Street address"],
                        ["street2", "Apt / suite (optional)"],
                        ["city", "City"],
                        ["stateCode", "State (optional)"],
                        ["postcode", "Postal code"],
                        ["countryCode", "Country (2 letters)"],
                        ["phoneNumber", "Phone"],
                        ["contactEmail", "Email (order updates)"],
                      ] as Array<[keyof BookPrintAddressForm, string]>
                    ).map(([key, label]) => (
                      <input
                        key={key}
                        className={deskInputCls(isLight)}
                        placeholder={label}
                        maxLength={key === "countryCode" ? 2 : 200}
                        value={printForm[key]}
                        onChange={(e) => setPrintForm({ ...printForm, [key]: e.target.value })}
                        aria-label={label}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className={goldBtn}
                    disabled={printBusy !== null || !printQuantityReady(quantity)}
                    onClick={() => void getPrintQuote()}
                  >
                    {printBusy === "quote" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Get the print quote — free
                  </button>

                  {quote ? (
                    <div className={`space-y-2 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
                      <p className={`text-sm ${strong}`}>
                        {quote.quantity} × 6″×9″ paperback ({quote.pageCount} pages) — print{" "}
                        {quote.priceVb.toLocaleString("en-US")} Bucs (${quote.printCostUsd.toFixed(2)})
                      </p>
                      <div className="space-y-1">
                        {quote.shippingOptions.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className={`flex w-full justify-between rounded-lg border px-3 py-2 text-sm bdv-touch-target ${
                              shippingLevel === s.id
                                ? isLight
                                  ? "border-[#d4af37] text-[#2a1e07]"
                                  : "border-[#d4af37] text-white"
                                : isLight
                                  ? "border-[#C9A84C]/30 text-[#6B5B36]"
                                  : "border-white/10 text-white/60"
                            }`}
                            onClick={() => setShippingLevel(s.id)}
                            aria-pressed={shippingLevel === s.id}
                          >
                            <span>{s.label}</span>
                            <span className="font-bold">${s.costUsd.toFixed(2)}</span>
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className={goldBtn}
                        disabled={printBusy !== null}
                        onClick={() => void placePrintOrder()}
                      >
                        {printBusy === "order" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
                        Confirm order —{" "}
                        {printTotalVb(quote, quote.shippingOptions.find((s) => s.id === shippingLevel)?.costUsd ?? 0).toLocaleString("en-US")}{" "}
                        Bucs
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {printOrdersStrip}
          </div>
        )}
      </div>
    </NativeCard>
  );
}
