import bcrypt from "bcryptjs";
import crypto from "crypto";

// A bcrypt hash of random bytes — no plaintext password will ever match it.
// Used as a placeholder for accounts that don't have a real password yet
// (guest requester rows, invited-but-not-yet-accepted staff accounts).
export async function unusablePasswordHash() {
  return bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
}
