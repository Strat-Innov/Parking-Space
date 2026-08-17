import { PDFDocument, PDFFont, PDFForm, PDFPage, StandardFonts, rgb } from "pdf-lib";

// A real fillable PDF (AcroForm) — every value sits in an actual text field
// pre-filled with this system's data, editable afterward in any PDF viewer.
// Mirrors the original paper "PARKING SPACE REQUEST FORM" (PPI.SOF002_Rev.1)
// this system automates — same section layout and field labels, adapted
// where our data model has no 1:1 equivalent: no Contact Number field, the
// original's "Slot/s" charging column is relabeled "Month/s" to match this
// system's actual Hourly/Daily/Monthly service types, and the old
// "PPISOF.PC-####" numbering is replaced by the request's real id plus a
// generated-on timestamp.
export type PdfRequestData = {
  id: string;
  fullName: string;
  companyName: string;
  emailAddress: string;
  dateOfRequest: string; // ISO
  serviceType: string;
  preferredParkingLocation: string;
  requestedSlot: string | null;
  assignedSlot: string | null;
  requiredStartDate: string; // ISO
  endDate: string; // ISO
  purpose: string;
  totalHours: number | null;
  totalDays: number | null;
  totalMonths: number | null;
  rateAmountSnapshot: number | null;
  totalPaymentDue: number | null;
  payDate: string | null; // ISO
  officialReceiptReference: string | null;
  status: string;
  preparedByName: string | null;
  validatedByName: string | null;
};

const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BLACK = rgb(0, 0, 0);
const HEADER_BG = rgb(0.9, 0.9, 0.9);
const LABEL_COLOR = rgb(0.35, 0.35, 0.35);

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : "";
}

function fmtTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

type FieldSpec = { name: string; label: string; value: string; flex?: number; multiline?: boolean };

function drawOuterBorder(page: PDFPage, top: number, bottom: number) {
  page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: CONTENT_WIDTH,
    height: top - bottom,
    borderColor: BLACK,
    borderWidth: 1.2,
  });
}

function drawTitle(page: PDFPage, font: PDFFont, top: number, text: string): number {
  const height = 30;
  const y = top - height;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, color: BLACK, thickness: 1 });
  const width = font.widthOfTextAtSize(text, 15);
  page.drawText(text, { x: MARGIN + (CONTENT_WIDTH - width) / 2, y: y + 11, size: 15, font, color: BLACK });
  return y;
}

function drawSectionHeader(page: PDFPage, font: PDFFont, top: number, label: string): number {
  const height = 16;
  const y = top - height;
  page.drawRectangle({ x: MARGIN, y, width: CONTENT_WIDTH, height, color: HEADER_BG });
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, color: BLACK, thickness: 1 });
  page.drawText(label, { x: MARGIN + 6, y: y + 5, size: 8, font, color: BLACK });
  return y;
}

function fieldRow(
  form: PDFForm,
  page: PDFPage,
  labelFont: PDFFont,
  namePrefix: string,
  top: number,
  fields: FieldSpec[],
  rowHeight = 34
): number {
  const y = top - rowHeight;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, color: BLACK, thickness: 1 });

  const totalFlex = fields.reduce((sum, f) => sum + (f.flex ?? 1), 0);
  let x = MARGIN;
  fields.forEach((f, i) => {
    const w = (CONTENT_WIDTH * (f.flex ?? 1)) / totalFlex;
    if (i > 0) {
      page.drawLine({ start: { x, y }, end: { x, y: y + rowHeight }, color: BLACK, thickness: 1 });
    }
    page.drawText(f.label.toUpperCase(), { x: x + 6, y: y + rowHeight - 12, size: 6, font: labelFont, color: LABEL_COLOR });

    const textField = form.createTextField(`${namePrefix}_${f.name}`);
    textField.setText(f.value);
    if (f.multiline) textField.enableMultiline();
    textField.addToPage(page, {
      x: x + 5,
      y: y + 4,
      width: w - 10,
      height: f.multiline ? rowHeight - 20 : 14,
      borderWidth: 0,
    });
    textField.setFontSize(9);
    x += w;
  });

  return y;
}

export async function buildFillableForm(requests: PdfRequestData[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const form = pdfDoc.getForm();

  requests.forEach((r, index) => {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const namePrefix = `p${index}`;
    const top = PAGE_HEIGHT - MARGIN;

    let y = drawTitle(page, boldFont, top, "PARKING SPACE REQUEST FORM");

    y = drawSectionHeader(page, boldFont, y, "Requestor's Details");
    y = fieldRow(form, page, font, namePrefix, y, [
      { name: "fullName", label: "Complete Name", value: r.fullName },
      { name: "dateOfRequest", label: "Date of Request", value: fmtDate(r.dateOfRequest) },
    ]);
    y = fieldRow(form, page, font, namePrefix, y, [
      { name: "companyName", label: "Company Name", value: r.companyName },
      { name: "emailAddress", label: "Email Address", value: r.emailAddress },
    ]);

    y = drawSectionHeader(page, boldFont, y, "Parking Space Requirement");
    y = fieldRow(form, page, font, namePrefix, y, [
      { name: "location", label: "Location", value: r.preferredParkingLocation },
      { name: "slots", label: "Slot(s)", value: r.assignedSlot ?? r.requestedSlot ?? "Not yet assigned" },
    ]);
    y = fieldRow(form, page, font, namePrefix, y, [
      { name: "startDate", label: "Required Start Date", value: fmtDate(r.requiredStartDate) },
      { name: "startTime", label: "Start Time", value: fmtTime(r.requiredStartDate) },
      { name: "endDate", label: "End Date", value: fmtDate(r.endDate) },
      { name: "endTime", label: "End Time", value: fmtTime(r.endDate) },
    ]);
    y = fieldRow(
      form,
      page,
      font,
      namePrefix,
      y,
      [{ name: "purpose", label: "Purpose", value: r.purpose, multiline: true }],
      50
    );

    y = drawSectionHeader(page, boldFont, y, "Computation of Charges");
    // The original form's charging basis (Hour/s | Day/s | Slot/s) maps to
    // this system's actual service types — only the column matching the
    // request's own serviceType has a number, since a request is always
    // exactly one type, never a mix.
    y = fieldRow(form, page, font, namePrefix, y, [
      { name: "totalHours", label: "Hour/s", value: r.totalHours != null ? String(r.totalHours) : "" },
      { name: "totalDays", label: "Day/s", value: r.totalDays != null ? String(r.totalDays) : "" },
      { name: "totalMonths", label: "Month/s", value: r.totalMonths != null ? String(r.totalMonths) : "" },
    ]);
    y = fieldRow(form, page, font, namePrefix, y, [
      { name: "rate", label: "Rate Applied (Php)", value: r.rateAmountSnapshot != null ? r.rateAmountSnapshot.toFixed(2) : "" },
      {
        name: "totalDue",
        label: "Total Payment Due (Php)",
        value: r.totalPaymentDue != null ? r.totalPaymentDue.toFixed(2) : "",
      },
      { name: "payDate", label: "Pay Date", value: fmtDate(r.payDate) },
    ]);
    y = fieldRow(form, page, font, namePrefix, y, [
      { name: "receiptRef", label: "Official Receipt Reference", value: r.officialReceiptReference ?? "" },
    ]);

    y = fieldRow(
      form,
      page,
      font,
      namePrefix,
      y,
      [
        { name: "preparedBy", label: "Prepared by", value: r.preparedByName ?? "" },
        { name: "validatedBy", label: "Validated by", value: r.validatedByName ?? "" },
      ],
      30
    );

    drawOuterBorder(page, top, y);

    const footerText = `Reference: ${r.id} · Status: ${r.status} · Generated by Parking Space Request Automation on ${new Date().toLocaleString()}`;
    page.drawText(footerText, { x: MARGIN, y: y - 14, size: 6, font, color: LABEL_COLOR });
  });

  form.updateFieldAppearances(font);
  return pdfDoc.save();
}
