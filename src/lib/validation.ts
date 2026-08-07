import { z } from "zod";
import { SERVICE_TYPES } from "./types";

// Shared by POST /api/requests (create) and POST /api/requests/[id]/edit —
// an edit must never be held to a looser standard than the original
// submission.
export const intakeFieldsSchema = z.object({
  fullName: z.string().min(1),
  companyName: z.string().min(1),
  emailAddress: z.string().email(),
  serviceType: z.enum(SERVICE_TYPES),
  preferredParkingLocation: z.string().min(1),
  requiredStartDate: z.coerce.date(),
  endDate: z.coerce.date(),
  purpose: z.string().min(1),
});
