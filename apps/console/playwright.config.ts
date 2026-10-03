import { defineConfig, devices } from "@playwright/test";

// Headless browser tests for the console. By default they run against `vite preview` (local play,
// no API). Set E2E_BASE_URL to test a running `wrangler dev` or the deployed Worker instead.
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 120_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: external ?? "http://localhost:4173",
    viewport: { width: 1600, height: 950 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 950 }, launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } },
    },
  ],
  webServer: external ? undefined : { command: "pnpm build && pnpm preview --port 4173 --strictPort", port: 4173, reuseExistingServer: true, timeout: 180_000 },
});
