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

/** Sim time from the command post clock ("D+1 14:05"). */
const commandClockMs = async (page: Page) => {
  const t = (await page.locator(".clock-box .clock").textContent()) ?? "D+0 00:00";
  const m = t.match(/D\+(\d+) (\d+):(\d+)/)!;
  return ((+m[1] * 24 + +m[2]) * 60 + +m[3]) * 60_000;
};

test("landing shows the theater map and the mission before play", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "WARFARE SENTINEL" })).toBeVisible();
  await expect(page.locator(".cmap-landing canvas")).toBeVisible();
  for (const name of ["Strait Crisis", "Northern Plains", "Archipelago", "Dark Skies"]) await expect(page.getByRole("radio", { name })).toBeVisible();
  await expect(page.locator(".mission-box")).toContainText("Keep the Meridian Strait open");
  await page.getByRole("radio", { name: "Corvane Union" }).click();
  await expect(page.locator(".mission-box")).toContainText("Seize Meridian Island");
  await expect(page.locator(".obj-marker").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Take command/ })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("lobby lists the five starter scenarios", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/lobby");
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

test("command game: intent, briefing, ask and drill-down", async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => localStorage.setItem("ws.intro", "1"));
  await page.goto("/play/strait-crisis?side=BLUE&level=commander&seed=42");
  await expect(page.getByText("Set your commander's intent")).toBeVisible();
  await page.getByRole("button", { name: "Issue intent" }).click();
  await page.getByRole("button", { name: "Max", exact: true }).click();
  await page.keyboard.press(" ");
  await expect.poll(() => commandClockMs(page), { timeout: 40_000 }).toBeGreaterThan(90 * 60_000);
  await expect(page.locator(".bluf p")).not.toBeEmpty();
  await expect.poll(() => page.locator(".alert").count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.locator(".tile")).toHaveCount(8);
  // Fog of war: the commander's map carries only our own units; enemies appear as contacts.
  await expect.poll(() => page.evaluate(() => {
    const m = (window as unknown as { __map?: { querySourceFeatures(id: string): { properties: { icon: string } }[] } }).__map!;
    return [...new Set(m.querySourceFeatures("entities").map((f) => f.properties.icon.split("|")[0]))];
  }), { timeout: 15_000 }).toEqual(["F"]);
  const ask = page.getByLabel("Ask your staff");
  await ask.fill("how are we doing?");
  await ask.press("Enter");
  await expect(page.locator(".reply-a")).not.toBeEmpty();
  await ask.fill("go defensive");
  await ask.press("Enter");
  await page.getByRole("button", { name: "Set defensive posture" }).click();
  await page.getByRole("tab", { name: "Actions" }).click();
  await expect(page.getByRole("button", { name: "Defensive", pressed: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("listitem", { name: /^Comms/ }).click();
  await expect(page.getByRole("dialog", { name: "Communications" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("first game opens the introduction and the guided tour", async ({ page }) => {
  await page.goto("/play/sandbox?side=RED&level=officer&seed=3");
  await expect(page.getByRole("dialog", { name: "How to play" })).toBeVisible();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Show me around" }).click();
  await expect(page.locator(".tour-tip")).toContainText("Your mission");
  await page.getByRole("button", { name: "End tour" }).click();
  await expect(page.locator(".tour-tip")).toHaveCount(0);
});

test("phone layout: no sideways scrolling, panels open as sheets", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("ws.intro", "1"));
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Take command/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/play/strait-crisis?side=RED&level=recruit&seed=3");
  await expect(page.locator(".tabbar")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator(".tabbar").getByRole("button", { name: /Briefing/ }).click();
  await expect(page.getByText("Set your commander's intent")).toBeVisible();
  await page.locator(".tabbar").getByRole("button", { name: /Status/ }).click();
  await expect(page.locator(".status-board.compact .tile")).toHaveCount(8);
  await ctx.close();
});
