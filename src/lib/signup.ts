// Domain allowlist for public self-service signup (/signup, no login
// required). Kept separate from the staff-only Add Account flow (/accounts,
// requires an existing session) — that one has no domain restriction since
// it's already gated by "you must already be a trusted, logged-in user."
const DEFAULT_ALLOWED_DOMAINS = ["filinvestcity.com"];

export function getAllowedSignupDomains(): string[] {
  const raw = process.env.ALLOWED_SIGNUP_EMAIL_DOMAINS;
  if (!raw) return DEFAULT_ALLOWED_DOMAINS;
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailDomainAllowedForSignup(email: string): boolean {
  const domain = email.toLowerCase().split("@")[1];
  if (!domain) return false;
  return getAllowedSignupDomains().includes(domain);
}
