import { prisma } from "@/lib/prisma";

// Order matters: children before parents, since schema.prisma declares no
// onDelete anywhere. TRUNCATE ... CASCADE would work regardless, but listing
// them explicitly documents the dependency graph the app itself relies on.
const TABLES = [
  "RequestEvent",
  "AccessRequestEvent",
  "ParkingRequest",
  "AccessRequest",
  "RateTableEntry",
  "ParkingSpace",
  "User",
] as const;

// Second line of defence behind vitest.config.mts's missing-variable check.
// The suite is destructive; refuse to point it at anything not obviously a
// test database.
function assertSafeDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  const name = url.split("/").pop()?.split("?")[0] ?? "";
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run destructive tests against database "${name}". ` +
        "The database name must contain \"test\".",
    );
  }
}

export async function resetDatabase() {
  assertSafeDatabase();
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

export { prisma };
