import { Resend } from "resend";
import { ROLE_LABELS, type Role } from "./types";

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
const FROM = process.env.EMAIL_FROM ?? "Parking Pro Inc. <onboarding@resend.dev>";

// The Resend SDK does NOT throw on a rejected send (e.g. unverified sending
// domain, invalid recipient) — it resolves with { error } instead. Every
// caller in this file needs that surfaced as a real error, not a silent
// success, so callers (invite/signup routes) can correctly report failures
// instead of claiming "sent" when nothing went out.
async function send(params: Parameters<Resend["emails"]["send"]>[0]) {
  const { error } = await getClient().emails.send(params);
  if (error) {
    throw new Error(`Resend rejected the email: ${error.message}`);
  }
}

export async function sendConfirmationEmail(to: string, name: string, confirmUrl: string) {
  await send({
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

export async function sendInviteEmail(to: string, name: string, role: Role, acceptUrl: string) {
  await send({
    from: FROM,
    to,
    subject: "You've been invited to Parking Space",
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>A colleague has set up a Parking Space Request Automation account for you as <strong>${escapeHtml(ROLE_LABELS[role])}</strong>. Set your password to activate it:</p>
      <p><a href="${acceptUrl}">Set my password</a></p>
      <p>This link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>
    `,
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
