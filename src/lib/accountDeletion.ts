import { prisma } from "./prisma";

// Every relation a User row can be referenced by, across both Parking Space
// and Parking Access. None of these FKs cascade (checked schema.prisma —
// no onDelete anywhere), so a raw prisma.user.delete() on an account with
// any of this history would just throw a raw constraint-violation error.
// Checking first lets /api/accounts/[id]/delete give a clear "use Deactivate
// instead" message rather than a crash.
export async function accountHasHistory(userId: string): Promise<boolean> {
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
  if (!counts) return false;
  return Object.values(counts._count).some((c) => c > 0);
}
