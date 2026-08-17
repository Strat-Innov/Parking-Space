import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";

// One page per request, laid out to mirror the original paper
// "PARKING SPACE REQUEST FORM" (PPI.SOF002_Rev.1) this system replaces —
// same sections and field labels, adapted where our data model doesn't
// carry a 1:1 equivalent (see comments below).
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

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  outer: { flexGrow: 1, borderWidth: 1.5, borderColor: "#000" },
  title: {
    fontSize: 15,
    fontWeight: 700,
    textAlign: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: "#000",
  },
  sectionLabel: {
    fontSize: 8,
    fontWeight: 700,
    backgroundColor: "#e5e5e5",
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderColor: "#000",
  },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#000" },
  rowNoBorder: { flexDirection: "row" },
  cell: { flex: 1, padding: 6, borderRightWidth: 1, borderColor: "#000" },
  cellLast: { flex: 1, padding: 6 },
  label: { fontSize: 7, color: "#555", marginBottom: 2, textTransform: "uppercase" },
  value: { fontSize: 9.5 },
  purposeBlock: { padding: 6, minHeight: 34, borderBottomWidth: 1, borderColor: "#000" },
  chargesGrid: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#000" },
  chargesCol: { flex: 1, borderRightWidth: 1, borderColor: "#000" },
  chargesColLast: { flex: 1 },
  chargesHeader: { fontSize: 7, fontWeight: 700, textAlign: "center", padding: 4, borderBottomWidth: 1, borderColor: "#000" },
  chargesValue: { fontSize: 9.5, textAlign: "center", padding: 6 },
  footerRow: { flexDirection: "row" },
  footerCell: { flex: 1, padding: 8, borderRightWidth: 1, borderColor: "#000" },
  footerCellLast: { flex: 1, padding: 8 },
  signatureLine: { marginTop: 18, borderTopWidth: 1, borderColor: "#000", paddingTop: 3, fontSize: 7, color: "#555", textAlign: "center" },
  refBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderColor: "#000",
    fontSize: 7,
    color: "#555",
  },
});

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Field({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={last ? styles.cellLast : styles.cell}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value || "—"}</Text>
    </View>
  );
}

export default function ParkingRequestFormDocument({ requests }: { requests: PdfRequestData[] }) {
  return (
    <Document>
      {requests.map((r) => {
        // The original form's charging basis (Hour/s | Day/s | Slot/s) maps
        // to this system's actual service types (Hourly/Daily/Monthly) —
        // only the column matching the request's own serviceType has a
        // number, since a request is always exactly one type, never a mix.
        const chargeCols = [
          { label: "Hour/s", value: r.totalHours },
          { label: "Day/s", value: r.totalDays },
          { label: "Month/s", value: r.totalMonths },
        ];

        return (
          <Page key={r.id} size="A4" style={styles.page}>
            <View style={styles.outer}>
              <Text style={styles.title}>PARKING SPACE REQUEST FORM</Text>

              <Text style={styles.sectionLabel}>Requestor&apos;s Details</Text>
              <View style={styles.row}>
                <Field label="Complete Name" value={r.fullName} />
                <Field label="Date of Request" value={fmtDate(r.dateOfRequest)} last />
              </View>
              <View style={styles.row}>
                <Field label="Company Name" value={r.companyName} />
                <Field label="Email Address" value={r.emailAddress} last />
              </View>

              <Text style={styles.sectionLabel}>Parking Space Requirement</Text>
              <View style={styles.row}>
                <Field label="Location" value={r.preferredParkingLocation} />
                <Field label="Slot(s)" value={r.assignedSlot ?? r.requestedSlot ?? "Not yet assigned"} last />
              </View>
              <View style={styles.row}>
                <Field label="Required Start Date" value={fmtDate(r.requiredStartDate)} />
                <Field label="Start Time" value={fmtTime(r.requiredStartDate)} />
                <Field label="End Date" value={fmtDate(r.endDate)} />
                <Field label="End Time" value={fmtTime(r.endDate)} last />
              </View>
              <View style={styles.purposeBlock}>
                <Text style={styles.label}>Purpose</Text>
                <Text style={styles.value}>{r.purpose || "—"}</Text>
              </View>

              <Text style={styles.sectionLabel}>Computation of Charges</Text>
              <View style={styles.chargesGrid}>
                {chargeCols.map((c, i) => (
                  <View key={c.label} style={i === chargeCols.length - 1 ? styles.chargesColLast : styles.chargesCol}>
                    <Text style={styles.chargesHeader}>{c.label}</Text>
                    <Text style={styles.chargesValue}>{c.value ?? "—"}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.row}>
                <Field label="Rate Applied (Php)" value={r.rateAmountSnapshot != null ? r.rateAmountSnapshot.toFixed(2) : "—"} />
                <Field label="Total Payment Due (Php)" value={r.totalPaymentDue != null ? r.totalPaymentDue.toFixed(2) : "—"} />
                <Field label="Pay Date" value={fmtDate(r.payDate)} last />
              </View>
              <View style={styles.row}>
                <Field label="Official Receipt Reference" value={r.officialReceiptReference ?? "—"} last />
              </View>

              <View style={styles.footerRow}>
                <View style={styles.footerCell}>
                  <Text style={styles.signatureLine}>Prepared by: {r.preparedByName ?? "—"}</Text>
                </View>
                <View style={styles.footerCellLast}>
                  <Text style={styles.signatureLine}>Validated by: {r.validatedByName ?? "—"}</Text>
                </View>
              </View>

              <View style={styles.refBar}>
                <Text>
                  Reference: {r.id} · Status: {r.status}
                </Text>
                <Text>Generated by Parking Space Request Automation on {new Date().toLocaleString()}</Text>
              </View>
            </View>
          </Page>
        );
      })}
    </Document>
  );
}
