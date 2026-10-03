import { expect, test, type Page } from "@playwright/test";

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // The API is absent under `vite preview`; network failures to /api are expected there.
    if (m.type() === "error" && !/\/api\/|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

const clockMs = async (page: Page) => {
  const t = (await page.locator(".clock").textContent()) ?? "D+0T00:00Z";
  const m = t.match(/D\+(\d+)T(\d+):(\d+)Z/)!;
  return ((+m[1] * 24 + +m[2]) * 60 + +m[3]) * 60_000;
};

test("lobby lists the five starter scenarios", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "WARFARE SENTINEL" })).toBeVisible();
  for (const name of ["Strait Crisis", "Northern Plains", "Archipelago", "Dark Skies", "Sandbox"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("local session runs, renders the globe and every console", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/local/strait-crisis/42");
  await expect(page.locator(".clock")).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => clockMs(page), { timeout: 30_000 }).toBeGreaterThan(2 * 3_600_000);

  // The MapLibre globe has the scenario landmasses and unit symbols.
  await expect.poll(() => page.evaluate(() => {
    const m = (window as unknown as { __map?: { querySourceFeatures(id: string): unknown[] } }).__map;
    return m ? m.querySourceFeatures("entities").length : 0;
  }), { timeout: 20_000 }).toBeGreaterThan(50);

  // Agents decide and engagements appear in the event log.
  await expect(page.getByText(/RULES \d+/).first()).toBeVisible();
  await expect.poll(() => page.locator("table.grid tr").count()).toBeGreaterThan(5);

  for (const tab of ["2 · Orbital", "3 · Kill Chain", "4 · Sensor & Signature", "5 · Air Operations", "6 · Maritime", "7 · Land Operations", "8 · Drone & Swarm", "9 · C2 Network", "10 · Logistics", "After-Action Review", "12 · Strategic Dashboard"]) {
    const t = page.getByText(tab, { exact: true });
    if (await t.count()) {
      await t.first().click();
      await page.waitForTimeout(400);
    }
  }
  await expect(page.getByText("Escalation ladder", { exact: false }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("fog of war: the Blue view shows only Blue units", async ({ page }) => {
  await page.goto("/local/sandbox/7");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => clockMs(page), { timeout: 30_000 }).toBeGreaterThan(3_600_000);
  await page.getByRole("button", { name: "■ Blue" }).first().click();
  await expect(page.locator(".console-head").filter({ hasText: "BLUE common operational picture" })).toBeVisible();
  // MapLibre re-tiles the source asynchronously after the view switch, so poll until it settles.
  await expect.poll(() => page.evaluate(() => {
    const m = (window as unknown as { __map?: { querySourceFeatures(id: string): { properties: { icon: string } }[] } }).__map!;
    return [...new Set(m.querySourceFeatures("entities").map((f) => f.properties.icon.split("|")[0]))];
  }), { timeout: 15_000 }).toEqual(["F"]); // own units are friendly; enemies appear only as tracks
});

test("rewind replays deterministically to an earlier time", async ({ page }) => {
  await page.goto("/local/sandbox/11");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => clockMs(page), { timeout: 30_000 }).toBeGreaterThan(4 * 3_600_000);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByLabel("Timeline scrubber");
  await slider.evaluate((el: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, String(2 * 3_600_000));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await slider.dispatchEvent("mouseup");
  await expect.poll(() => clockMs(page), { timeout: 30_000 }).toBe(2 * 3_600_000);
});

test("Monte Carlo batch runs in browser workers", async ({ page }) => {
  await page.goto("/montecarlo");
  await page.getByLabel("Seeds").fill("3");
  await page.getByLabel("Hours per run").fill("6");
  await page.getByRole("button", { name: "Run batch" }).click();
  await expect(page.getByText("Outcomes", { exact: true })).toBeVisible({ timeout: 90_000 });
});
