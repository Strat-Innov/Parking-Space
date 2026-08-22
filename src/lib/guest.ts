import { repos } from "./data";

// Shared by both public intake forms (/requests/new and /access/new) — an
// anonymous submission is attributed to the account matching the email if one
// already exists (which may be a STAFF account, not only a guest row), and
// otherwise to a lightweight "guest" User row with an unusable random password
// hash: they were never meant to log back in as it, only to have submitted the
// request at all. This mirrors BR-003/BR-004 — once submitted, the requester
// has no further access, loop or otherwise.
export async function resolveGuestRequesterId(fullName: string, emailAddress: string) {
  return repos.users.resolveRequesterForSubmission(fullName, emailAddress);
}
