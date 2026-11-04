import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  BOOK_AI_ASSIST_PATH,
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
   Sell" button is a link out to the storefronts page (?title=…),
   not a books rail. World law forbids the exit, so the desk does NOT fake a
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

/** Catalog keys for the seam's label lists — the seam keeps the
 *  English labels as defaults; the desk renders its own language. */
const ASSIST_LABEL_KEYS: Record<BookAssistAction, string> = {
  continue: "worldCatalogLibrary.booksAssistContinue",
  rewrite: "worldCatalogLibrary.booksAssistRewrite",
  expand: "worldCatalogLibrary.booksAssistExpand",
  outline: "worldCatalogLibrary.booksAssistOutline",
  "title-ideas": "worldCatalogLibrary.booksAssistTitleIdeas",
  blurb: "worldCatalogLibrary.booksAssistBlurb",
};
const PRINT_COLOR_KEYS: Record<string, string> = {
  bw: "worldCatalogLibrary.booksPrintColorBw",
  color: "worldCatalogLibrary.booksPrintColorColor",
};
const ADDRESS_FIELD_KEYS: Record<keyof BookPrintAddressForm, string> = {
  name: "worldCatalogLibrary.booksAddrName",
  street1: "worldCatalogLibrary.booksAddrStreet1",
  street2: "worldCatalogLibrary.booksAddrStreet2",
  city: "worldCatalogLibrary.booksAddrCity",
  stateCode: "worldCatalogLibrary.booksAddrState",
  postcode: "worldCatalogLibrary.booksAddrPostcode",
  countryCode: "worldCatalogLibrary.booksAddrCountry",
  phoneNumber: "worldCatalogLibrary.booksAddrPhone",
  contactEmail: "worldCatalogLibrary.booksAddrEmail",
};

export function BooksDesk({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const usd = (n: number): string =>
    new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD" }).format(n);
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
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCatalogLibrary.booksCreateErrorStatus", { status: res.status })));
      const made = normalizeBookDetail({ book: data["book"], chapters: [] });
      setCreateForm(EMPTY_BOOK_FORM);
      setShowCreate(false);
      setTick((n) => n + 1);
      if (made) {
        setNote(t("worldCatalogLibrary.booksCreatedNote", { title: made.book.title }));
        void openBook(made.book.id);
      } else {
        setNote(t("worldCatalogLibrary.booksStartedNote"));
      }
    } catch (err) {
      setError(plainErrorText(err, t("worldCatalogLibrary.booksCreateError")));
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
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCatalogLibrary.booksSaveBookErrorStatus", { status: res.status })));
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
      setNote(t("worldCatalogLibrary.sharedSaved"));
      setTick((n) => n + 1);
    } catch (err) {
      setError(plainErrorText(err, t("worldCatalogLibrary.booksSaveError")));
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
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCatalogLibrary.booksDeleteErrorStatus", { status: res.status })));
      setOpenId(null);
      setDetail(null);
      setConfirmDeleteBook(false);
      setNote(t("worldCatalogLibrary.booksDeletedNote"));
      setTick((n) => n + 1);
    } catch (err) {
      setError(plainErrorText(err, t("worldCatalogLibrary.booksDeleteError")));
    } finally {
      setBusy(null);
    }
  }

  async function addChapter() {
    if (!detail || busy) return;
    const title = newChapterTitle.trim() || t("worldCatalogLibrary.booksChapterDefault", { count: detail.chapters.length + 1 });
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
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCatalogLibrary.booksAddChapterErrorStatus", { status: res.status })));
      const ch = normalizeCreatedChapter(data);
      if (!ch) throw new Error("chapter shape");
      setDetail({ ...detail, chapters: [...detail.chapters, ch] });
      setNewChapterTitle("");
      selectChapter(ch);
      setNote(t("worldCatalogLibrary.booksChapterAddedNote"));
    } catch (err) {
      setError(plainErrorText(err, t("worldCatalogLibrary.booksAddChapterError")));
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
      if (!res.ok) throw new Error(apiErrorMessage(data as Record<string, unknown>, t("worldCatalogLibrary.booksSaveChapterErrorStatus", { status: res.status })));
      const wc = typeof data.wordCount === "number" ? data.wordCount : countBookWords(content);
      setDetail({
        ...detail,
        chapters: detail.chapters.map((c) =>
          c.id === activeChapter.id ? { ...c, content, wordCount: wc } : c,
        ),
      });
      setNote(t("worldCatalogLibrary.booksChapterSavedNote"));
    } catch (err) {
      setError(plainErrorText(err, t("worldCatalogLibrary.booksSaveChapterError")));
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
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCatalogLibrary.booksRenameChapterErrorStatus", { status: res.status })));
      setDetail({
        ...detail,
        chapters: detail.chapters.map((c) =>
          c.id === activeChapter.id ? { ...c, title: chapterTitleDraft.trim() } : c,
        ),
      });
    } catch (err) {
      setError(plainErrorText(err, t("worldCatalogLibrary.booksRenameChapterError")));
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
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCatalogLibrary.booksDeleteChapterErrorStatus", { status: res.status })));
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
      setNote(t("worldCatalogLibrary.booksChapterDeletedNote"));
    } catch (err) {
      setError(plainErrorText(err, t("worldCatalogLibrary.booksDeleteChapterError")));
    } finally {
      setBusy(null);
    }
  }

  async function runAssist(action: BookAssistAction) {
    if (!detail || assistRunning) return;
    const needsChapter = assistActionChapterOnly(action);
    if (needsChapter && !activeChapter) {
      setError(t("worldCatalogLibrary.booksAssistPickChapter"));
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
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCatalogLibrary.booksAssistErrorStatus", { status: res.status })));
      const text = normalizeAssistResult(data);
      if (!text) throw new Error("assist shape");
      setAssistResult({ action, text });
    } catch (err) {
      setError(plainErrorText(err, t("worldCatalogLibrary.booksAssistError")));
    } finally {
      setAssistRunning(null);
    }
  }

  function insertAssistResult() {
    if (!assistResult || !assistResultInsertable(assistResult.action)) return;
    setContent(content ? `${content}\n\n${assistResult.text}` : assistResult.text);
    setNote(t("worldCatalogLibrary.booksInsertNote"));
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
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCatalogLibrary.booksCoverErrorStatus", { status: res.status })));
      const url = normalizeCoverResult(data);
      if (!url) throw new Error("cover shape");
      setDetail({ ...detail, book: { ...detail.book, coverUrl: url } });
      setNote(t("worldCatalogLibrary.booksCoverDoneNote"));
      setTick((n) => n + 1);
    } catch (err) {
      setError(plainErrorText(err, t("worldCatalogLibrary.booksCoverError")));
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
        throw new Error(apiErrorMessage(data, t("worldCatalogLibrary.booksExportErrorStatus", { status: res.status })));
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
      setNote(t("worldCatalogLibrary.booksExportNote", { format: format.toUpperCase() }));
    } catch (err) {
      setError(plainErrorText(err, t("worldCatalogLibrary.booksExportError")));
    } finally {
      setExporting(null);
    }
  }

  async function getPrintQuote() {
    if (!detail || printBusy) return;
    if (!printAddressReady(printForm) || !printQuantityReady(quantity)) {
      setError(t("worldCatalogLibrary.booksQuoteGateError"));
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
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCatalogLibrary.booksQuoteErrorStatus", { status: res.status })));
      const parsed = normalizePrintQuote(data);
      if (!parsed) throw new Error("quote shape");
      setQuote(parsed);
      if (parsed.shippingOptions.length > 0 && !parsed.shippingOptions.some((s) => s.id === shippingLevel)) {
        setShippingLevel(parsed.shippingOptions[0].id);
      }
    } catch (err) {
      setError(plainErrorText(err, t("worldCatalogLibrary.booksQuoteError")));
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
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCatalogLibrary.booksOrderErrorStatus", { status: res.status })));
      const placed = normalizePrintOrderPlaced(data);
      setQuote(null);
      setNote(
        placed
          ? t("worldCatalogLibrary.booksOrderPlacedAmount", { amount: placed.priceVb.toLocaleString(i18n.language) })
          : t("worldCatalogLibrary.booksOrderPlaced"),
      );
      setTick((n) => n + 1);
    } catch (err) {
      setError(plainErrorText(err, t("worldCatalogLibrary.booksOrderError")));
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
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCatalogLibrary.booksStatusErrorStatus", { status: res.status })));
      const status = typeof data["status"] === "string" ? data["status"] : order.status;
      setOrders((os) => (os ?? []).map((o) => (o.id === order.id ? { ...o, status } : o)));
    } catch (err) {
      setError(plainErrorText(err, t("worldCatalogLibrary.booksStatusError")));
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
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCatalogLibrary.booksCancelErrorStatus", { status: res.status })));
      setConfirmCancelOrderId(null);
      setOrders((os) => (os ?? []).map((o) => (o.id === order.id ? { ...o, status: "canceled" } : o)));
      setNote(t("worldCatalogLibrary.booksCanceledNote"));
    } catch (err) {
      setError(plainErrorText(err, t("worldCatalogLibrary.booksCancelError")));
    } finally {
      setPrintBusy(null);
    }
  }

  const bookFields = (form: BookForm, setForm: (f: BookForm) => void, prefix: string) => (
    <div className="space-y-2">
      <input
        className={deskInputCls(isLight)}
        placeholder={t("worldCatalogLibrary.booksPlaceholderTitle")}
        maxLength={200}
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        aria-label={t("worldCatalogLibrary.booksAriaTitle", { prefix })}
      />
      <div className="flex flex-wrap gap-2">
        <input
          className={deskInputCls(isLight)}
          placeholder={t("worldCatalogLibrary.booksPlaceholderAuthor")}
          maxLength={200}
          value={form.authorName}
          onChange={(e) => setForm({ ...form, authorName: e.target.value })}
          aria-label={t("worldCatalogLibrary.booksAriaAuthor", { prefix })}
        />
        <input
          className={deskInputCls(isLight)}
          placeholder={t("worldCatalogLibrary.booksPlaceholderSubtitle")}
          maxLength={200}
          value={form.subtitle}
          onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
          aria-label={t("worldCatalogLibrary.booksAriaSubtitle", { prefix })}
        />
        <input
          className={deskInputCls(isLight)}
          placeholder={t("worldCatalogLibrary.booksPlaceholderGenre")}
          maxLength={100}
          value={form.genre}
          onChange={(e) => setForm({ ...form, genre: e.target.value })}
          aria-label={t("worldCatalogLibrary.booksAriaGenre", { prefix })}
        />
      </div>
      <textarea
        className={deskInputCls(isLight)}
        placeholder={t("worldCatalogLibrary.booksPlaceholderDescription")}
        rows={2}
        maxLength={2000}
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        aria-label={t("worldCatalogLibrary.booksAriaDescription", { prefix })}
      />
    </div>
  );

  const printOrdersStrip = orders && orders.length > 0 ? (
    <div className="space-y-1.5" data-testid="world-books-print-orders">
      <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>{t("worldCatalogLibrary.booksOrdersTitle")}</p>
      {orders.slice(0, 10).map((o) => (
        <div
          key={o.id}
          className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
            isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
          }`}
        >
          <Package className="h-4 w-4 text-[#d4af37]" />
          <span className={`text-xs font-bold ${strong}`}>
            {t("worldCatalogLibrary.booksOrderRow", { quantity: o.quantity, pages: o.pageCount, status: o.status })}
            {o.amountCents > 0 ? ` · ${usd(o.amountCents / 100)}` : ""}
          </span>
          <button type="button" className={chipBtn(isLight)} disabled={printBusy !== null} onClick={() => void refreshOrderStatus(o)}>
            {printBusy === `status-${o.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t("worldCatalogLibrary.booksRefreshStatus")}
          </button>
          {o.status !== "canceled" ? (
            <button
              type="button"
              className={confirmCancelOrderId === o.id ? goldBtn : chipBtn(isLight)}
              disabled={printBusy !== null}
              onClick={() => void cancelOrder(o)}
            >
              {confirmCancelOrderId === o.id ? t("worldCatalogLibrary.booksCancelConfirm") : t("worldCatalogLibrary.booksCancel")}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  ) : null;

  return (
    <NativeCard isLight={isLight} title={t("worldCatalogLibrary.booksTitle")}>
      <div data-testid="world-books-desk" className="space-y-3">
        {error ? <p className={`text-xs ${errCls}`}>{error}</p> : null}
        {note ? <p className={`text-xs font-semibold ${strong}`}>{note}</p> : null}
        {outOfCredits ? (
          <p className={`text-xs font-semibold ${strong}`}>
            {t("worldCatalogLibrary.booksOutOfCredits")}
          </p>
        ) : null}

        {openId === null ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={`text-sm ${muted}`}>
                {t("worldCatalogLibrary.booksIntro", { assist: BOOK_AI_ASSIST_COST_VB, cover: BOOK_COVER_COST_VB })}
              </p>
              <button type="button" className={goldBtn} onClick={() => setShowCreate((s) => !s)} aria-expanded={showCreate}>
                <Plus className="h-3.5 w-3.5" /> {t("worldCatalogLibrary.booksNew")}
              </button>
            </div>

            {showCreate ? (
              <div data-testid="world-books-create" className="space-y-2">
                {bookFields(createForm, setCreateForm, t("worldCatalogLibrary.booksPrefixNew"))}
                <button
                  type="button"
                  className={goldBtn}
                  disabled={!bookFormReady(createForm) || creating}
                  onClick={() => void create()}
                >
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {t("worldCatalogLibrary.booksStartButton")}
                </button>
              </div>
            ) : null}

            {loadFailed ? (
              <NativeErrorState
                isLight={isLight}
                title={t("worldCatalogLibrary.booksLoadErrorTitle")}
                message={t("worldCatalogLibrary.booksLoadErrorMessage")}
                onRetry={() => setTick((n) => n + 1)}
              />
            ) : books === null ? (
              <NativeLoadingState isLight={isLight} message={t("worldCatalogLibrary.booksLoading")} />
            ) : books.length === 0 ? (
              <NativeEmptyState
                isLight={isLight}
                message={t("worldCatalogLibrary.booksEmpty")}
                detail={t("worldCatalogLibrary.booksEmptyDetail")}
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
                    {t("worldCatalogLibrary.sharedOpen")}
                  </button>
                </div>
              ))
            )}
            {printOrdersStrip}
          </>
        ) : detailFailed ? (
          <div className="space-y-2">
            <button type="button" className={chipBtn(isLight)} onClick={() => setOpenId(null)}>
              <ArrowLeft className="h-3.5 w-3.5" /> {t("worldCatalogLibrary.booksAllBack")}
            </button>
            <NativeErrorState
              isLight={isLight}
              title={t("worldCatalogLibrary.booksDetailErrorTitle")}
              message={t("worldCatalogLibrary.booksDetailErrorMessage")}
              onRetry={() => openId && void openBook(openId)}
            />
          </div>
        ) : detail === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldCatalogLibrary.booksDetailLoading")} />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={chipBtn(isLight)} onClick={() => setOpenId(null)}>
                <ArrowLeft className="h-3.5 w-3.5" /> {t("worldCatalogLibrary.booksAllBack")}
              </button>
              <span className={`text-sm font-black ${strong}`}>{detail.book.title}</span>
              <span className={`text-xs ${muted}`}>
                {t(detail.chapters.length === 1 ? "worldCatalogLibrary.booksChapterOne" : "worldCatalogLibrary.booksChapterMany", { count: detail.chapters.length })} ·{" "}
                {t("worldCatalogLibrary.booksWordsCount", { count: totalBookWords(detail.chapters, activeChapterId, content).toLocaleString(i18n.language) })}
              </span>
            </div>

            {/* Book fields */}
            {bookFields(editForm, setEditForm, t("worldCatalogLibrary.booksPrefixBook"))}
            <button
              type="button"
              className={chipBtn(isLight)}
              disabled={!bookFormReady(editForm) || busy !== null}
              onClick={() => void saveBookFields()}
            >
              {busy === "save-book" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t("worldCatalogLibrary.booksSaveWords")}
            </button>

            {/* Chapters */}
            <div className="space-y-1.5">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>{t("worldCatalogLibrary.booksChaptersTitle")}</p>
              {detail.chapters.length === 0 ? (
                <NativeEmptyState
                  isLight={isLight}
                  message={t("worldCatalogLibrary.booksNoChapters")}
                  detail={t("worldCatalogLibrary.booksNoChaptersDetail")}
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
                      <span className={`ml-2 text-xs ${muted}`}>{t("worldCatalogLibrary.booksWordsCount", { count: c.wordCount.toLocaleString(i18n.language) })}</span>
                    </button>
                    <button
                      type="button"
                      className={confirmDeleteChapterId === c.id ? goldBtn : chipBtn(isLight)}
                      disabled={busy !== null}
                      onClick={() => void removeChapter(c)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {confirmDeleteChapterId === c.id ? t("worldCatalogLibrary.booksDeleteChapterConfirm") : ""}
                    </button>
                  </div>
                ))
              )}
              <div className="flex gap-2">
                <input
                  className={deskInputCls(isLight)}
                  placeholder={t("worldCatalogLibrary.booksNewChapterPlaceholder")}
                  maxLength={200}
                  value={newChapterTitle}
                  onChange={(e) => setNewChapterTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void addChapter()}
                  aria-label={t("worldCatalogLibrary.booksAriaNewChapter")}
                />
                <button type="button" className={goldBtn} disabled={busy !== null} onClick={() => void addChapter()}>
                  {busy === "add-chapter" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {t("worldCatalogLibrary.booksAddChapter")}
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
                    aria-label={t("worldCatalogLibrary.booksAriaChapterTitle")}
                  />
                </div>
                <textarea
                  className={deskInputCls(isLight)}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={t("worldCatalogLibrary.booksEditorPlaceholder")}
                  rows={10}
                  aria-label={t("worldCatalogLibrary.booksAriaChapterText")}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs ${muted}`}>{t("worldCatalogLibrary.booksWordsInChapter", { count: countBookWords(content).toLocaleString(i18n.language) })}</span>
                  <button type="button" className={goldBtn} disabled={busy !== null} onClick={() => void saveChapterContent()}>
                    {busy === "save-chapter" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    {t("worldCatalogLibrary.booksSaveChapter")}
                  </button>
                </div>
              </div>
            ) : null}

            {/* AI ghostwriter */}
            <div className="space-y-2" data-testid="world-books-assist">
              <p className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.12em] ${muted}`}>
                <Sparkles className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldCatalogLibrary.booksAssistTitle", { cost: BOOK_AI_ASSIST_COST_VB })}
              </p>
              <input
                className={deskInputCls(isLight)}
                placeholder={t("worldCatalogLibrary.booksAssistInstructionPlaceholder")}
                maxLength={2000}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                aria-label={t("worldCatalogLibrary.booksAriaAssistInstruction")}
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
                    {t(ASSIST_LABEL_KEYS[a.id])}
                  </button>
                ))}
              </div>
              {assistResult ? (
                <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-[#C9A84C]/30 bg-white/5"}`}>
                  <p className={`whitespace-pre-wrap text-sm ${strong}`}>{assistResult.text}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {assistResultInsertable(assistResult.action) && activeChapter ? (
                      <button type="button" className={goldBtn} onClick={insertAssistResult}>
                        {t("worldCatalogLibrary.booksInsert")}
                      </button>
                    ) : null}
                    <button type="button" className={chipBtn(isLight)} onClick={() => setAssistResult(null)}>
                      {t("worldCatalogLibrary.booksDismiss")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Cover */}
            <div className="space-y-2" data-testid="world-books-cover">
              <p className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.12em] ${muted}`}>
                <ImageIcon className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldCatalogLibrary.booksCoverTitle", { cost: BOOK_COVER_COST_VB })}
              </p>
              {detail.book.coverUrl ? (
                <img src={detail.book.coverUrl} alt={t("worldCatalogLibrary.booksCoverAlt", { title: detail.book.title })} className="h-36 w-24 rounded-lg object-cover" />
              ) : (
                <p className={`text-xs ${muted}`}>{t("worldCatalogLibrary.booksNoCover")}</p>
              )}
              <div className="flex gap-2">
                <input
                  className={deskInputCls(isLight)}
                  placeholder={t("worldCatalogLibrary.booksCoverStylePlaceholder")}
                  maxLength={200}
                  value={coverStyle}
                  onChange={(e) => setCoverStyle(e.target.value)}
                  aria-label={t("worldCatalogLibrary.booksAriaCoverStyle")}
                />
                <button type="button" className={goldBtn} disabled={coverBusy} onClick={() => void generateCover()}>
                  {coverBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  {detail.book.coverUrl
                    ? t("worldCatalogLibrary.booksCoverNew", { cost: BOOK_COVER_COST_VB })
                    : t("worldCatalogLibrary.booksCoverGenerate", { cost: BOOK_COVER_COST_VB })}
                </button>
              </div>
            </div>

            {/* Publish outputs: export + print */}
            <div className="space-y-2" data-testid="world-books-publish">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>{t("worldCatalogLibrary.booksPublishTitle")}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={chipBtn(isLight)}
                  disabled={!bookExportReady(detail.chapters.length) || exporting !== null}
                  onClick={() => void exportBook("epub")}
                >
                  {exporting === "epub" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  {t("worldCatalogLibrary.booksExportEpub")}
                </button>
                <button
                  type="button"
                  className={chipBtn(isLight)}
                  disabled={!bookExportReady(detail.chapters.length) || exporting !== null}
                  onClick={() => void exportBook("pdf")}
                >
                  {exporting === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  {t("worldCatalogLibrary.booksExportPdf")}
                </button>
                <button
                  type="button"
                  className={chipBtn(isLight)}
                  disabled={!bookExportReady(detail.chapters.length)}
                  onClick={() => setShowPrint((s) => !s)}
                  aria-expanded={showPrint}
                >
                  <Printer className="h-3.5 w-3.5" /> {t("worldCatalogLibrary.booksPrintButton")}
                </button>
                <button
                  type="button"
                  className={confirmDeleteBook ? goldBtn : chipBtn(isLight)}
                  disabled={busy !== null}
                  onClick={() => void removeBook()}
                >
                  {busy === "delete-book" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  {confirmDeleteBook ? t("worldCatalogLibrary.sharedDeleteConfirm") : t("worldCatalogLibrary.booksDelete")}
                </button>
              </div>
              {!bookExportReady(detail.chapters.length) ? (
                <p className={`text-xs ${muted}`}>{t("worldCatalogLibrary.booksExportHint")}</p>
              ) : null}

              {showPrint ? (
                <div className="space-y-2" data-testid="world-books-print">
                  <p className={`text-xs ${muted}`}>
                    {t("worldCatalogLibrary.booksPrintIntro")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <label className={`flex items-center gap-2 text-xs font-bold ${strong}`}>
                      {t("worldCatalogLibrary.booksCopies")}
                      <input
                        type="number"
                        min={1}
                        max={100}
                        className={deskInputCls(isLight)}
                        value={quantity}
                        onChange={(e) => setQuantity(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                        aria-label={t("worldCatalogLibrary.booksAriaCopies")}
                      />
                    </label>
                    <div className="flex gap-2" role="group" aria-label={t("worldCatalogLibrary.booksAriaInterior")}>
                      {BOOK_PRINT_COLORS.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          className={color === c.key ? goldBtn : chipBtn(isLight)}
                          onClick={() => setColor(c.key)}
                          aria-pressed={color === c.key}
                        >
                          {t(PRINT_COLOR_KEYS[c.key] ?? c.key)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(Object.keys(ADDRESS_FIELD_KEYS) as Array<keyof BookPrintAddressForm>).map((key) => (
                      <input
                        key={key}
                        className={deskInputCls(isLight)}
                        placeholder={t(ADDRESS_FIELD_KEYS[key])}
                        maxLength={key === "countryCode" ? 2 : 200}
                        value={printForm[key]}
                        onChange={(e) => setPrintForm({ ...printForm, [key]: e.target.value })}
                        aria-label={t(ADDRESS_FIELD_KEYS[key])}
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
                    {t("worldCatalogLibrary.booksQuoteButton")}
                  </button>

                  {quote ? (
                    <div className={`space-y-2 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
                      <p className={`text-sm ${strong}`}>
                        {t("worldCatalogLibrary.booksQuoteLine", {
                          quantity: quote.quantity,
                          pages: quote.pageCount,
                          price: quote.priceVb.toLocaleString(i18n.language),
                          usd: quote.printCostUsd.toFixed(2),
                        })}
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
                            <span className="font-bold">{usd(s.costUsd)}</span>
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
                        {t("worldCatalogLibrary.booksOrderConfirm", {
                          total: printTotalVb(quote, quote.shippingOptions.find((s) => s.id === shippingLevel)?.costUsd ?? 0).toLocaleString(i18n.language),
                        })}
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
