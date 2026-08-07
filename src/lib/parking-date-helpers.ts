// Client-side date/time helpers shared by the create form (/requests/new)
// and the Prepared-By edit form, so both compute the same minimums the
// server enforces (see validateIntakeFields in workflows.ts).

export function toDateStr(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toTimeStr(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDaysStr(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

export function addMonthsStr(dateStr: string, months: number) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return toDateStr(d);
}

// Minimum valid End Date depends on Service Type: Hourly can be same-day
// (duration comes from Start/End Time instead); Daily needs at least the
// next calendar day (the check-in time carries onto End Date too, so
// same-day would be zero duration); Monthly needs a full calendar month.
export function minEndDateFor(startDate: string, serviceType: string) {
  if (!startDate) return startDate;
  if (serviceType === "Monthly") return addMonthsStr(startDate, 1);
  if (serviceType === "Daily") return addDaysStr(startDate, 1);
  return startDate; // Hourly
}
