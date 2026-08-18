import { Resend } from "resend";

// Lazily constructed so the app can still build/boot without RESEND_API_KEY
// set (e.g. local dev before the key is provisioned) — only sending an
// actual email requires it.
let client: Resend | null = null;
function getClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set. Add it in Vercel (or .env for local dev) to send email.");
  }
  if (!client) client = new Resend(apiKey);
  return client;
}

// Verified sender address in Resend. Defaults to Resend's own shared testing
// domain, which only delivers to the account owner's own inbox — set
// EMAIL_FROM once a real domain is verified in the Resend dashboard.
const FROM = process.env.EMAIL_FROM ?? "Parking Space <onboarding@resend.dev>";

export async function sendConfirmationEmail(to: string, name: string, confirmUrl: string) {
  await getClient().emails.send({
    from: FROM,
    to,
    subject: "Confirm your Parking Space account",
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Thanks for signing up for Parking Space Request Automation. Confirm your email address to activate your account:</p>
      <p><a href="${confirmUrl}">Confirm my email</a></p>
      <p>This link expires in 24 hours. If you didn't create this account, you can ignore this email.</p>
    `,
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
