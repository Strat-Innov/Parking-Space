import { beforeEach, afterAll } from "vitest";
import { prisma, resetDatabase } from "./db";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});
