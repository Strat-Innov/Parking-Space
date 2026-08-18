import { prisma } from "./prisma";

// Every relation a User row can be referenced by, across both Parking Space
// and Parking Access. None of these FKs cascade (checked schema.prisma —
// no onDelete anywhere), so a raw prisma.user.delete() on an account with
// any of this history would just throw a raw constraint-violation error.
// Checking first lets /api/accounts/[id]/delete give a clear, specific
// message instead of a crash or an unexplained "can't delete this."
const HISTORY_LABELS = {
  requestsSubmitted: "request(s) submitted",
  requestsPrepared: "request(s) prepared",
  requestsValidated: "request(s) validated",
  requestsRejected: "request(s) rejected",
  requestsCashiered: "request(s) with a payment they confirmed",
  requestsAssigned: "request(s) with a slot they assigned",
  rateTableEntries: "rate table entr(y/ies) they added",
  parkingSpaces: "parking space(s) they added",
  events: "request timeline event(s)",
  accessRequestsSubmitted: "access request(s) submitted",
  accessRequestsProcessed: "access request(s) processed",
  accessRequestsCompleted: "access request(s) completed",
  accessRequestsCancelled: "access request(s) cancelled",
  accessEvents: "access request timeline event(s)",
} as const;

export async function getAccountHistoryBreakdown(userId: string): Promise<Record<string, number>> {
  const counts = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      _count: {
        select: {
          requestsSubmitted: true,
          requestsPrepared: true,
          requestsValidated: true,
          requestsRejected: true,
          requestsCashiered: true,
          requestsAssigned: true,
          rateTableEntries: true,
          parkingSpaces: true,
          events: true,
          accessRequestsSubmitted: true,
          accessRequestsProcessed: true,
          accessRequestsCompleted: true,
          accessRequestsCancelled: true,
          accessEvents: true,
        },
      },
    },
  });
  return counts?._count ?? {};
}

export function describeAccountHistory(breakdown: Record<string, number>): string {
  return Object.entries(breakdown)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${count} ${HISTORY_LABELS[key as keyof typeof HISTORY_LABELS]}`)
    .join(", ");
}
