// Applies prisma/schema.prisma to the TEST database.
//
// Prisma reads DATABASE_URL from .env, which points at the development
// database. The test suite must never touch that, so this script reads
// TEST_DATABASE_URL from .env.test (or the environment) and hands it to Prisma
// as DATABASE_URL for this one command only.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

function fromEnvFile(file, key) {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const url = process.env.TEST_DATABASE_URL ?? fromEnvFile(".env.test", "TEST_DATABASE_URL");

if (!url) {
  console.error(
    "TEST_DATABASE_URL is not set. Copy .env.test.example to .env.test and point it at a\n" +
      "throwaway Postgres database — the suite truncates every table before each test.",
  );
  process.exit(1);
}

const name = url.split("/").pop()?.split("?")[0] ?? "";
if (!/test/i.test(name)) {
  console.error(`Refusing to push the schema to database "${name}" — its name must contain "test".`);
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
