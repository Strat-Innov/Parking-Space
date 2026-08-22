import { repos } from "./data";

// Every relation a User row can be referenced by that represents REAL
// workflow involvement — none of these FKs cascade (checked schema.prisma —
// no onDelete anywhere), so deleting an account with any of this history
// would just throw a raw constraint-violation error. Checking first lets
// /api/accounts/[id]/delete give a clear, specific message instead of a crash
// or an unexplained "can't delete this."
//
// Deliberately EXCLUDES RateTableEntry.createdBy and ParkingSpace.createdBy
// — those are attribution only ("who added this row"), not a workflow
// dependency, so deleting the account just nulls them out instead (see
// deleteWithAttributionCleared) rather than blocking on them.
const HISTORY_LABELS = {
  requestsSubmitted: "request(s) submitted",
  requestsPrepared: "request(s) prepared",
  requestsValidated: "request(s) validated",
  requestsRejected: "request(s) rejected",
  requestsCashiered: "request(s) with a payment they confirmed",
  requestsAssigned: "request(s) with a slot they assigned",
  events: "request timeline event(s)",
  accessRequestsSubmitted: "access request(s) submitted",
  accessRequestsProcessed: "access request(s) processed",
  accessRequestsCompleted: "access request(s) completed",
  accessRequestsCancelled: "access request(s) cancelled",
  accessEvents: "access request timeline event(s)",
} as const;

export async function getAccountHistoryBreakdown(userId: string): Promise<Record<string, number>> {
  return repos.users.countWorkflowHistory(userId);
}

export function describeAccountHistory(breakdown: Record<string, number>): string {
  return Object.entries(breakdown)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${count} ${HISTORY_LABELS[key as keyof typeof HISTORY_LABELS]}`)
    .join(", ");
}
