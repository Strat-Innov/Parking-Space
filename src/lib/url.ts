// Absolute base URL for links sent in emails. APP_URL is the explicit
// override (set it in Vercel once the production domain is known);
// VERCEL_URL is auto-injected per-deployment but has no protocol; falls
// back to localhost for local dev.
export function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
