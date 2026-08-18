import crypto from "crypto";
import { getAppUrl } from "./url";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function createVerificationToken() {
  return {
    token: crypto.randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  };
}

export function buildConfirmUrl(token: string) {
  return `${getAppUrl()}/api/auth/verify-email?token=${token}`;
}
