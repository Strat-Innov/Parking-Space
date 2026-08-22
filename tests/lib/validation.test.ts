import { describe, it, expect } from "vitest";
import { intakeFieldsSchema } from "@/lib/validation";
import { accessIntakeFieldsSchema } from "@/lib/access-validation";

const validIntake = {
  fullName: "Casey",
  companyName: "Acme",
  emailAddress: "casey@acme.test",
  serviceType: "Daily",
  preferredParkingLocation: "Tower A",
  requiredStartDate: "2026-05-01T09:00:00.000Z",
  endDate: "2026-05-04T09:00:00.000Z",
  purpose: "Staff parking",
};

const validAccess = {
  enrollmentType: "Individual",
  requestType: "New Enrollment",
  fullName: "Casey",
  companyName: "Acme",
  emailAddress: "casey@acme.test",
  vehiclePlateNumber: "ABC-123",
  propertyLocation: "Tower A",
  contactNumber: "0917",
  requestedQuantity: 2,
  accessType: "RFID Sticker/Card/Metal Tag",
};

// Shared by create and edit so an edit is never held to a looser standard than
// the original submission.
describe("intakeFieldsSchema", () => {
  it("accepts a complete payload and coerces date strings", () => {
    const parsed = intakeFieldsSchema.parse(validIntake);
    expect(parsed.requiredStartDate).toBeInstanceOf(Date);
    expect(parsed.endDate).toBeInstanceOf(Date);
  });

  it.each(["fullName", "companyName", "preferredParkingLocation", "purpose"] as const)(
    "rejects an empty %s",
    (field) => {
      expect(intakeFieldsSchema.safeParse({ ...validIntake, [field]: "" }).success).toBe(false);
    },
  );

  it("rejects a malformed email", () => {
    expect(intakeFieldsSchema.safeParse({ ...validIntake, emailAddress: "nope" }).success).toBe(false);
  });

  it("rejects a service type outside the enum", () => {
    expect(intakeFieldsSchema.safeParse({ ...validIntake, serviceType: "Weekly" }).success).toBe(false);
  });

  it.each(["Hourly", "Daily", "Monthly"] as const)("accepts service type %s", (serviceType) => {
    expect(intakeFieldsSchema.safeParse({ ...validIntake, serviceType }).success).toBe(true);
  });

  it("treats requestedSlot as optional", () => {
    expect(intakeFieldsSchema.safeParse(validIntake).success).toBe(true);
    expect(intakeFieldsSchema.safeParse({ ...validIntake, requestedSlot: "A-01" }).success).toBe(true);
  });

  it("rejects an unparseable date", () => {
    expect(
      intakeFieldsSchema.safeParse({ ...validIntake, requiredStartDate: "not-a-date" }).success,
    ).toBe(false);
  });
});

describe("accessIntakeFieldsSchema", () => {
  it("accepts a complete payload", () => {
    expect(accessIntakeFieldsSchema.safeParse(validAccess).success).toBe(true);
  });

  it("coerces a numeric string quantity", () => {
    const parsed = accessIntakeFieldsSchema.parse({ ...validAccess, requestedQuantity: "3" });
    expect(parsed.requestedQuantity).toBe(3);
  });

  it.each([0, -1, 1.5])("rejects a quantity of %s", (requestedQuantity) => {
    expect(accessIntakeFieldsSchema.safeParse({ ...validAccess, requestedQuantity }).success).toBe(false);
  });

  it("rejects an access type outside the enum", () => {
    expect(
      accessIntakeFieldsSchema.safeParse({ ...validAccess, accessType: "Skeleton Key" }).success,
    ).toBe(false);
  });

  it("requires both transfer fields on a Transfer request", () => {
    const result = accessIntakeFieldsSchema.safeParse({ ...validAccess, requestType: "Transfer" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/Transfer To and Transfer From/);
    }
  });

  it("accepts a Transfer request carrying both fields", () => {
    expect(
      accessIntakeFieldsSchema.safeParse({
        ...validAccess,
        requestType: "Transfer",
        transferTo: "Tower B",
        transferFrom: "Tower A",
      }).success,
    ).toBe(true);
  });

  it("rejects a Transfer request with only one side filled", () => {
    expect(
      accessIntakeFieldsSchema.safeParse({
        ...validAccess,
        requestType: "Transfer",
        transferTo: "Tower B",
      }).success,
    ).toBe(false);
  });

  it("ignores blank transfer fields on non-Transfer request types", () => {
    expect(
      accessIntakeFieldsSchema.safeParse({ ...validAccess, requestType: "Renewal" }).success,
    ).toBe(true);
  });
});
