/**
 * InvoiceGeneratorPanel — honest load standard (deep-pins
 * tranche 5). PINNED POST-FIX. THE FIX (this tranche):
 * loadInvoices used to swallow non-ok and throws alike
 * ("list is a convenience"), leaving invoices=[] so a failed
 * list load painted the outreach.invoice.listEmpty copy
 * ("No invoices yet — generate your first one above."). The
 * load now owns a listError state and the render order is
 * listLoading → listFailed line + Retry → honest empty →
 * list. The money flows were already honest and are pinned
 * briefly: generate downloads the PDF and reloads the list
 * only past its ok + invoice + pdfBase64 gate (cancel silent,
 * 402 = out-of-credits), setStatus replaces the row only
 * past its own gate, and the PDF download throws on !ok
 * before any click — never a fake success.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./InvoiceGeneratorPanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("THE FIX — the invoice list fails honestly", () => {
  it("non-ok, unparseable and thrown reads all land on listError; only a checked array lands the list", () => {
    expect(src).toContain("const [listError, setListError] = useState(false);");
    const body = slice(src, "async function loadInvoices() {", "useEffect(() => { void loadInvoices(); }, [user]);");
    expect(body).toContain("setListError(false);");
    expect(body).toContain("if (res.ok && Array.isArray(data.invoices)) {");
    expect(body).toContain("setInvoices(data.invoices);");
    expect(body).toContain("setListError(true);");
    expect(body.indexOf("if (res.ok && Array.isArray(data.invoices)) {")).toBeLessThan(
      body.indexOf("setInvoices(data.invoices);"),
    );
    const catchPart = slice(body, "} catch {", "} finally {");
    expect(catchPart).toContain("setListError(true);");
    expect(catchPart).not.toContain("setInvoices");
  });

  it("render order: listLoading → listFailed + Retry → listEmpty → the rows", () => {
    const body = slice(src, "{listLoading ? (", "{error && (");
    expect(body).toContain(") : listError ? (");
    expect(body).toContain('{t("outreach.invoice.listFailed")}');
    expect(body).toContain("onClick={() => void loadInvoices()}");
    expect(body).toContain('{t("common.retry")}');
    expect(body).toContain(") : invoices.length === 0 ? (");
    expect(body).toContain('{t("outreach.invoice.listEmpty")}');
    expect(body.indexOf("{listLoading ? (")).toBeLessThan(body.indexOf(") : listError ? ("));
    expect(body.indexOf(") : listError ? (")).toBeLessThan(body.indexOf(") : invoices.length === 0 ? ("));
    expect(body.indexOf('{t("outreach.invoice.listFailed")}')).toBeLessThan(
      body.indexOf('{t("outreach.invoice.listEmpty")}'),
    );
  });
});

describe("the money flows, pinned briefly", () => {
  it("generate: cancel is silent; 402 is out-of-credits; the PDF + list reload happen only past the ok gate", () => {
    const body = slice(src, "async function generate() {", "async function downloadPdf(");
    expect(body).toContain("if (!res) return; // user cancelled the credit confirmation");
    expect(body).toContain('if (res.status === 402 || data.error === "out_of_credits") {');
    expect(body).toContain("if (!res.ok || !data.invoice || !data.pdfBase64) {");
    expect(body).toContain("throw new Error(apiErrorMessage(data, t(\"outreach.invoice.failed\")));");
    expect(body).toContain("downloadBase64Pdf(data.pdfBase64,");
    expect(body).toContain("await loadInvoices();");
    expect(body.indexOf("if (!res.ok || !data.invoice || !data.pdfBase64) {")).toBeLessThan(
      body.indexOf("downloadBase64Pdf(data.pdfBase64,"),
    );
    expect(body.indexOf("downloadBase64Pdf(data.pdfBase64,")).toBeLessThan(body.indexOf("await loadInvoices();"));
    const catchPart = slice(body, "} catch (err) {", "} finally {");
    expect(catchPart).toContain("setError(plainErrorText(err, t(\"outreach.invoice.failed\")));");
    expect(catchPart).not.toContain("downloadBase64Pdf");
  });

  it("setStatus replaces the row only past its ok gate; the PDF download throws on !ok before any click", () => {
    const status = slice(src, "async function setStatus(", "/* Handoff → Money Tracker");
    expect(status).toContain('if (!res.ok || !data.invoice) throw new Error("status update failed");');
    expect(status).toContain("setInvoices((prev) => prev.map((x) => (x.id === inv.id ? data.invoice! : x)));");
    expect(status.indexOf('if (!res.ok || !data.invoice) throw new Error("status update failed");')).toBeLessThan(
      status.indexOf("setInvoices((prev) => prev.map((x) => (x.id === inv.id ? data.invoice! : x)));"),
    );
    expect(status).toContain("setError(t(\"outreach.invoice.statusFailed\"));");
    const pdf = slice(src, "async function downloadPdf(", "function emailHref(");
    expect(pdf).toContain('if (!res.ok) throw new Error("download failed");');
    expect(pdf).toContain("link.click();");
    expect(pdf.indexOf('if (!res.ok) throw new Error("download failed");')).toBeLessThan(pdf.indexOf("link.click();"));
    const pdfCatch = slice(pdf, "} catch {", "function emailHref(");
    expect(pdfCatch).toContain("setError(t(\"outreach.invoice.failed\"));");
    expect(pdfCatch).not.toContain("click");
  });
});
