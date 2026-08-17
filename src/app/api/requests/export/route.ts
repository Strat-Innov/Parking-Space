import { createElement, type ReactElement } from "react";
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isActionable } from "@/lib/dashboard";
import { handleApiError } from "@/lib/api-helpers";
import ParkingRequestFormDocument, { type PdfRequestData } from "@/lib/pdf/ParkingRequestFormDocument";
import { STATUSES, SERVICE_TYPES, type Role } from "@/lib/types";

// Exports exactly the "Other Requests" set from the dashboard (same
// isActionable exclusion, same role scoping), narrowed by whatever
// search/status/serviceType the client currently has applied — re-derived
// from the DB server-side rather than trusting rows already in the browser.
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format");
    if (format !== "csv" && format !== "xlsx" && format !== "pdf") {
      return NextResponse.json({ error: "format must be csv, xlsx, or pdf." }, { status: 422 });
    }

    const search = searchParams.get("search")?.trim().toLowerCase() ?? "";
    const status = searchParams.get("status") ?? "";
    const serviceType = searchParams.get("serviceType") ?? "";
    if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) {
      return NextResponse.json({ error: "Invalid status filter." }, { status: 422 });
    }
    if (serviceType && !SERVICE_TYPES.includes(serviceType as (typeof SERVICE_TYPES)[number])) {
      return NextResponse.json({ error: "Invalid serviceType filter." }, { status: 422 });
    }

    const role = session.role as Role;
    const all = await prisma.parkingRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        preparedBy: { select: { name: true } },
        validatedBy: { select: { name: true } },
      },
    });

    const rows = all.filter((r) => {
      if (isActionable(role, r)) return false;
      if (search && !r.companyName.toLowerCase().includes(search)) return false;
      if (status && r.status !== status) return false;
      if (serviceType && r.serviceType !== serviceType) return false;
      return true;
    });

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "csv") {
      const csv = toCsv(rows);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="parking-requests-${stamp}.csv"`,
        },
      });
    }

    if (format === "xlsx") {
      const buffer = await toXlsx(rows);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="parking-requests-${stamp}.xlsx"`,
        },
      });
    }

    const pdfData: PdfRequestData[] = rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      companyName: r.companyName,
      emailAddress: r.emailAddress,
      dateOfRequest: r.dateOfRequest.toISOString(),
      serviceType: r.serviceType,
      preferredParkingLocation: r.preferredParkingLocation,
      requestedSlot: r.requestedSlot,
      assignedSlot: r.assignedSlot,
      requiredStartDate: r.requiredStartDate.toISOString(),
      endDate: r.endDate.toISOString(),
      purpose: r.purpose,
      totalHours: r.totalHours,
      totalDays: r.totalDays,
      totalMonths: r.totalMonths,
      rateAmountSnapshot: r.rateAmountSnapshot,
      totalPaymentDue: r.totalPaymentDue,
      payDate: r.payDate ? r.payDate.toISOString() : null,
      officialReceiptReference: r.officialReceiptReference,
      status: r.status,
      preparedByName: r.preparedBy?.name ?? null,
      validatedByName: r.validatedBy?.name ?? null,
    }));

    // renderToBuffer's types expect a <Document> element directly; our
    // component returns exactly that, but TS can't see through the
    // function-component boundary to verify it — safe to assert.
    const pdfElement = createElement(ParkingRequestFormDocument, { requests: pdfData }) as unknown as ReactElement<DocumentProps>;
    const buffer = await renderToBuffer(pdfElement);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="parking-requests-${stamp}.pdf"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

type ExportRow = {
  id: string;
  companyName: string;
  fullName: string;
  emailAddress: string;
  serviceType: string;
  status: string;
  approvalStage: string;
  paymentStatus: string;
  slotStatus: string;
  requiredStartDate: Date;
  endDate: Date;
  assignedSlot: string | null;
  totalPaymentDue: number | null;
};

const COLUMNS: { header: string; key: keyof ExportRow; width: number }[] = [
  { header: "ID", key: "id", width: 28 },
  { header: "Company", key: "companyName", width: 24 },
  { header: "Requestor", key: "fullName", width: 20 },
  { header: "Email", key: "emailAddress", width: 26 },
  { header: "Service Type", key: "serviceType", width: 12 },
  { header: "Status", key: "status", width: 16 },
  { header: "Approval Stage", key: "approvalStage", width: 16 },
  { header: "Payment Status", key: "paymentStatus", width: 14 },
  { header: "Slot Status", key: "slotStatus", width: 12 },
  { header: "Required Start", key: "requiredStartDate", width: 20 },
  { header: "End", key: "endDate", width: 20 },
  { header: "Assigned Slot", key: "assignedSlot", width: 20 },
  { header: "Total Payment Due", key: "totalPaymentDue", width: 16 },
];

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: ExportRow[]): string {
  const header = COLUMNS.map((c) => csvEscape(c.header)).join(",");
  const lines = rows.map((r) =>
    COLUMNS.map((c) => {
      const v = r[c.key];
      if (v instanceof Date) return csvEscape(v.toLocaleString());
      return csvEscape(v);
    }).join(",")
  );
  return [header, ...lines].join("\n");
}

async function toXlsx(rows: ExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Other Requests");
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.getRow(1).font = { bold: true };
  for (const r of rows) {
    sheet.addRow({
      ...r,
      requiredStartDate: r.requiredStartDate.toLocaleString(),
      endDate: r.endDate.toLocaleString(),
    });
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
