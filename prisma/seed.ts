import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "demo1234";

const USERS = [
  { name: "Rae Requester", email: "requester@parking.local", role: "REQUESTER" },
  { name: "Pat Preparer", email: "prepared@parking.local", role: "PREPARED_BY" },
  { name: "Val Validator", email: "validator@parking.local", role: "VALIDATED_BY" },
  { name: "Cass Cashier", email: "cashier@parking.local", role: "CASHIER" },
  { name: "Morgan Manager", email: "parkingmgmt@parking.local", role: "PARKING_MANAGEMENT" },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const users: Record<string, string> = {};
  for (const u of USERS) {
    const created = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { name: u.name, email: u.email, role: u.role, passwordHash },
    });
    users[u.role] = created.id;
  }

  const managerId = users["PARKING_MANAGEMENT"];
  const existingRates = await prisma.rateTableEntry.count();
  if (existingRates === 0) {
    await prisma.rateTableEntry.createMany({
      data: [
        {
          serviceType: "Hourly",
          chargingModel: "Hourly",
          rateAmount: 25,
          effectiveStartDate: new Date("2024-01-01"),
          createdById: managerId,
        },
        {
          serviceType: "Daily",
          chargingModel: "Daily",
          rateAmount: 150,
          effectiveStartDate: new Date("2024-01-01"),
          createdById: managerId,
        },
        {
          serviceType: "Monthly",
          chargingModel: "Monthly",
          rateAmount: 3000,
          effectiveStartDate: new Date("2024-01-01"),
          createdById: managerId,
        },
      ],
    });
  }

  console.log("Seeded demo users (password for all: %s):", DEMO_PASSWORD);
  for (const u of USERS) console.log(`  ${u.role.padEnd(20)} ${u.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
