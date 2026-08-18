import crypto from "crypto";
import { getAppUrl } from "./url";

const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — invitees may not check email right away

export function createVerificationToken(ttlMs: number = CONFIRM_TOKEN_TTL_MS) {
  return {
    token: crypto.randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + ttlMs),
  };
}

export function createInviteToken() {
  return createVerificationToken(INVITE_TOKEN_TTL_MS);
}

export function buildConfirmUrl(token: string) {
  return `${getAppUrl()}/api/auth/verify-email?token=${token}`;
}

export function buildAcceptInviteUrl(token: string) {
  return `${getAppUrl()}/accept-invite?token=${token}`;
}
