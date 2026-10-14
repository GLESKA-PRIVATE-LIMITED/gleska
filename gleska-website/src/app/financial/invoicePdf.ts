export interface InvoicePdfRecord {
  invoice_number: string;
  client_name: string;
  issue_date: string;
  due_date: string;
  payment_terms_notes: string;
  currency: "INR" | "USD" | "EUR";
  status: "DRAFT" | "GENERATED";
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  line_items: {
    description: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }[];
}

export interface InvoicePdfCompanyDetails {
  business_name?: string | null;
  registered_address?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  gstin?: string | null;
  company_email?: string | null;
  company_phone?: string | null;
}

const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const CANVAS_SCALE = 2;
const encoder = new TextEncoder();

const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`));

const formatMoney = (amount: number, currency: InvoicePdfRecord["currency"]) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);

const wrapText = (context: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }

    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
};

const createPdfPage = () => {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH * CANVAS_SCALE;
  canvas.height = PAGE_HEIGHT * CANVAS_SCALE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Invoice PDF canvas is unavailable.");
  context.scale(CANVAS_SCALE, CANVAS_SCALE);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.fillStyle = "#111827";
  context.textBaseline = "top";
  return { canvas, context };
};

const drawWrappedText = (
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight = 17,
) => {
  const lines = wrapText(context, text, maxWidth);
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return lines.length * lineHeight;
};

const toJpegBytes = (canvas: HTMLCanvasElement) =>
  new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Unable to render an invoice PDF page."));
        return;
      }
      try {
        resolve(new Uint8Array(await blob.arrayBuffer()));
      } catch (error) {
        reject(error);
      }
    }, "image/jpeg", 0.94);
  });

export async function createInvoicePdf(
  invoice: InvoicePdfRecord,
  company: InvoicePdfCompanyDetails | null,
  taxIdentifier: string,
): Promise<Blob> {
  if (invoice.status !== "GENERATED") {
    throw new Error("Only generated invoices can be downloaded as PDF.");
  }

  const pages: HTMLCanvasElement[] = [];
  const makePage = (firstPage: boolean) => {
    const page = createPdfPage();
    const { context } = page;
    context.fillStyle = "#111827";

    if (firstPage) {
      context.font = "bold 23px Arial, sans-serif";
      const companyName = company?.business_name?.trim();
      if (companyName) context.fillText(companyName, 58, 52, 410);

      context.font = "14px Arial, sans-serif";
      context.fillStyle = "#4b5563";
      const address = company?.registered_address || company?.address;
      if (address) drawWrappedText(context, address, 58, companyName ? 88 : 58, 400);
      const locality = [company?.city, company?.state, company?.pincode].filter(Boolean).join(", ");
      if (locality) context.fillText(locality, 58, address ? 124 : (companyName ? 88 : 58), 400);

      let companyY = companyName ? 156 : 90;
      if (company?.gstin) {
        context.fillText(`GSTIN: ${company.gstin}`, 58, companyY, 400);
        companyY += 20;
      }
      if (taxIdentifier.trim()) {
        context.fillText(`Tax ID: ${taxIdentifier.trim()}`, 58, companyY, 400);
        companyY += 20;
      }
      if (company?.company_email) {
        context.fillText(company.company_email, 58, companyY, 400);
        companyY += 20;
      }
      if (company?.company_phone) context.fillText(company.company_phone, 58, companyY, 400);

      context.textAlign = "right";
      context.fillStyle = "#4338ca";
      context.font = "bold 34px Arial, sans-serif";
      context.fillText("INVOICE", 736, 52);
      context.fillStyle = "#111827";
      context.font = "bold 17px Arial, sans-serif";
      context.fillText(invoice.invoice_number, 736, 101);
      context.textAlign = "left";

      context.strokeStyle = "#4f46e5";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(58, 248);
      context.lineTo(736, 248);
      context.stroke();

      context.fillStyle = "#6b7280";
      context.font = "bold 11px Arial, sans-serif";
      context.fillText("BILL TO", 58, 270);
      context.fillText("ISSUE DATE", 462, 270);
      context.fillText("DUE DATE", 602, 270);
      context.fillStyle = "#111827";
      context.font = "bold 15px Arial, sans-serif";
      context.fillText(invoice.client_name, 58, 291, 360);
      context.font = "14px Arial, sans-serif";
      context.fillText(formatDate(invoice.issue_date), 462, 291, 128);
      context.fillText(formatDate(invoice.due_date), 602, 291, 134);
    } else {
      context.fillStyle = "#4338ca";
      context.font = "bold 22px Arial, sans-serif";
      context.fillText("INVOICE", 58, 54);
      context.fillStyle = "#111827";
      context.font = "bold 16px Arial, sans-serif";
      context.fillText(invoice.invoice_number, 190, 57);
      context.textAlign = "right";
      context.font = "14px Arial, sans-serif";
      context.fillText(invoice.client_name, 736, 58, 400);
      context.textAlign = "left";
    }

    const tableY = firstPage ? 334 : 105;
    context.fillStyle = "#eef2ff";
    context.fillRect(58, tableY, 678, 36);
    context.fillStyle = "#374151";
    context.font = "bold 11px Arial, sans-serif";
    context.fillText("DESCRIPTION", 68, tableY + 12);
    context.textAlign = "right";
    context.fillText("QTY", 515, tableY + 12);
    context.fillText("UNIT RATE", 634, tableY + 12);
    context.fillText("LINE TOTAL", 726, tableY + 12);
    context.textAlign = "left";
    context.fillStyle = "#111827";
    context.font = "13px Arial, sans-serif";
    pages.push(page.canvas);
    return { context, y: tableY + 48 };
  };

  let page = makePage(true);
  for (const item of invoice.line_items) {
    page.context.font = "13px Arial, sans-serif";
    const descriptionLines = wrapText(page.context, item.description, 415);
    const rowHeight = Math.max(36, descriptionLines.length * 17 + 16);
    if (page.y + rowHeight > 990) page = makePage(false);

    page.context.fillStyle = "#111827";
    page.context.font = "13px Arial, sans-serif";
    descriptionLines.forEach((line, index) => page.context.fillText(line, 68, page.y + index * 17));
    page.context.textAlign = "right";
    page.context.fillText(
      new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(item.quantity),
      515,
      page.y,
    );
    page.context.fillText(formatMoney(item.unit_price, invoice.currency), 634, page.y);
    page.context.font = "bold 13px Arial, sans-serif";
    page.context.fillText(formatMoney(item.line_total, invoice.currency), 726, page.y);
    page.context.textAlign = "left";
    page.context.strokeStyle = "#e5e7eb";
    page.context.lineWidth = 1;
    page.context.beginPath();
    page.context.moveTo(58, page.y + rowHeight - 5);
    page.context.lineTo(736, page.y + rowHeight - 5);
    page.context.stroke();
    page.y += rowHeight;
  }

  if (page.y + 150 > 1030) page = makePage(false);
  const summaryTop = page.y + 10;
  const drawTotal = (label: string, value: string, y: number, bold = false) => {
    page.context.font = `${bold ? "bold " : ""}14px Arial, sans-serif`;
    page.context.fillStyle = bold ? "#111827" : "#4b5563";
    page.context.fillText(label, 452, y);
    page.context.textAlign = "right";
    page.context.fillText(value, 726, y);
    page.context.textAlign = "left";
  };
  drawTotal("Subtotal", formatMoney(invoice.subtotal, invoice.currency), summaryTop);
  drawTotal(
    `Tax (${invoice.tax_rate}%)`,
    formatMoney(invoice.tax_amount, invoice.currency),
    summaryTop + 27,
  );
  page.context.strokeStyle = "#9ca3af";
  page.context.beginPath();
  page.context.moveTo(452, summaryTop + 55);
  page.context.lineTo(736, summaryTop + 55);
  page.context.stroke();
  drawTotal("GRAND TOTAL", formatMoney(invoice.total, invoice.currency), summaryTop + 67, true);

  if (invoice.payment_terms_notes) {
    page.y = summaryTop + 108;
    page.context.fillStyle = "#6b7280";
    page.context.font = "bold 11px Arial, sans-serif";
    page.context.fillText("NOTES", 58, page.y);
    page.y += 22;
    page.context.fillStyle = "#374151";
    page.context.font = "13px Arial, sans-serif";
    const noteLines = wrapText(page.context, invoice.payment_terms_notes, 678);
    for (const line of noteLines) {
      if (page.y > 1038) {
        page = makePage(false);
        page.y += 4;
        page.context.fillStyle = "#6b7280";
        page.context.font = "bold 11px Arial, sans-serif";
        page.context.fillText("NOTES (CONTINUED)", 58, page.y);
        page.y += 22;
        page.context.fillStyle = "#374151";
        page.context.font = "13px Arial, sans-serif";
      }
      page.context.fillText(line, 58, page.y);
      page.y += 18;
    }
  }

  pages.forEach((canvas, index) => {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to finalize an invoice PDF page.");
    context.fillStyle = "#6b7280";
    context.font = "11px Arial, sans-serif";
    context.textAlign = "center";
    context.fillText(`Invoice ${invoice.invoice_number} · Page ${index + 1} of ${pages.length}`, 397, 1084);
  });

  const images = await Promise.all(pages.map(toJpegBytes));
  const objectCount = 2 + images.length * 3;
  const parts: Uint8Array[] = [];
  const offsets = new Array<number>(objectCount + 1).fill(0);
  let byteLength = 0;
  const append = (part: Uint8Array) => {
    parts.push(part);
    byteLength += part.length;
  };
  const appendText = (text: string) => append(encoder.encode(text));
  const appendObject = (objectId: number, body: string | Uint8Array) => {
    offsets[objectId] = byteLength;
    appendText(`${objectId} 0 obj\n`);
    if (typeof body === "string") appendText(body);
    else append(body);
    appendText("\nendobj\n");
  };

  appendText("%PDF-1.4\n");
  appendObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const pageReferences = images.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
  appendObject(2, `<< /Type /Pages /Kids [${pageReferences}] /Count ${images.length} >>`);

  images.forEach((image, index) => {
    const pageObject = 3 + index * 3;
    const contentObject = pageObject + 1;
    const imageObject = pageObject + 2;
    appendObject(
      pageObject,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] ` +
        `/Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`,
    );
    const content = encoder.encode("q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n");
    offsets[contentObject] = byteLength;
    appendText(`${contentObject} 0 obj\n<< /Length ${content.length} >>\nstream\n`);
    append(content);
    appendText("endstream\nendobj\n");
    offsets[imageObject] = byteLength;
    appendText(`${imageObject} 0 obj\n`);
    appendText(
      `<< /Type /XObject /Subtype /Image /Width ${PAGE_WIDTH * CANVAS_SCALE} ` +
        `/Height ${PAGE_HEIGHT * CANVAS_SCALE} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
    );
    append(image);
    appendText("\nendstream\nendobj\n");
  });

  const xrefOffset = byteLength;
  appendText(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let objectId = 1; objectId <= objectCount; objectId += 1) {
    appendText(`${String(offsets[objectId]).padStart(10, "0")} 00000 n \n`);
  }
  appendText(
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  const blobParts: BlobPart[] = parts.map((part) => {
    const buffer = new ArrayBuffer(part.byteLength);
    new Uint8Array(buffer).set(part);
    return buffer;
  });
  return new Blob(blobParts, { type: "application/pdf" });
}
