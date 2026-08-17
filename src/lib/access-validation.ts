import { z } from "zod";
import { ENROLLMENT_TYPES, ACCESS_REQUEST_TYPES, ACCESS_TYPES } from "./access-types";

export const accessIntakeFieldsSchema = z
  .object({
    enrollmentType: z.enum(ENROLLMENT_TYPES),
    requestType: z.enum(ACCESS_REQUEST_TYPES),
    transferTo: z.string().optional(),
    transferFrom: z.string().optional(),
    fullName: z.string().min(1),
    companyName: z.string().min(1),
    emailAddress: z.string().email(),
    vehiclePlateNumber: z.string().min(1),
    propertyLocation: z.string().min(1),
    contactNumber: z.string().min(1),
    requestedQuantity: z.coerce.number().int().positive(),
    accessType: z.enum(ACCESS_TYPES),
    remarks: z.string().optional(),
    approverName: z.string().optional(),
  })
  .refine((v) => v.requestType !== "Transfer" || (v.transferTo?.trim() && v.transferFrom?.trim()), {
    message: "Transfer requests need both a Transfer To and Transfer From location.",
    path: ["transferTo"],
  });
