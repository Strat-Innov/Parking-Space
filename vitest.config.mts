import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { loadEnv } from "vite";

// Reads .env.test / .env.test.local (see .env.test.example). TEST_DATABASE_URL
// is deliberately a DIFFERENT variable name from the app's DATABASE_URL and is
// never defaulted: the suite truncates every table before each test, so an
// accidental fallback to a dev or production connection string would destroy
// real data. Missing means fail loudly, never guess.
const env = loadEnv("test", process.cwd(), "");
const testDatabaseUrl = env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Copy .env.test.example to .env.test and point it " +
      "at a THROWAWAY Postgres database — the suite truncates every table before each test.",
  );
}

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Server-side workflow/persistence code, not React components.
    environment: "node",
    // Every test file shares the one database and truncates between tests, so
    // files must not run concurrently.
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/helpers/setup.ts"],
    env: { DATABASE_URL: testDatabaseUrl },
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
