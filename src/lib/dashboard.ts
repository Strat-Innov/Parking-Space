import type { ParkingRequest } from "@prisma/client";
import type { Role } from "@/lib/types";

// Shared between the dashboard page and the export route so "Other
// Requests" means exactly the same set of rows in both places.
export function isActionable(role: Role, r: Pick<ParkingRequest, "status" | "paymentStatus" | "slotStatus">) {
  switch (role) {
    case "PREPARED_BY":
      // WF02 (prepare/endorse) and WF04 (confirm payment) both land here now.
      return r.status === "In Preparation" || (r.status === "Approved" && r.paymentStatus !== "Confirmed");
    case "VALIDATED_BY":
      return r.status === "Pending Approval";
    case "PARKING_MANAGEMENT":
      return r.status === "Approved" && r.slotStatus !== "Assigned";
    default:
      return false;
  }
}
