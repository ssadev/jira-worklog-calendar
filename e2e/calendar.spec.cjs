const { test, expect } = require("@playwright/test");
const { setupAuthenticatedPage } = require("./fixtures/test-helpers.cjs");

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

test.describe("Calendar View", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedPage(page, "/?month=2026-04");
  });

  test("displays month header with navigation controls", async ({ page }) => {
    await expect(page.locator("text=April").first()).toBeVisible();
    await expect(page.locator("text=2026").first()).toBeVisible();
    await expect(page.locator('button:has-text("←")')).toBeVisible();
    await expect(page.locator('button:has-text("→")')).toBeVisible();
    await expect(page.locator('button:has-text("today")')).toBeVisible();
    await expect(page.locator('button:has-text("refresh")')).toBeVisible();
  });

  test("calendar grid shows day headers", async ({ page }) => {
    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      await expect(page.locator(`text=${day}`).first()).toBeVisible();
    }
  });

  test("month navigation changes displayed month", async ({ page }) => {
    // Go to previous month
    await page.locator('button:has-text("←")').click();
    await expect(page.locator("text=March").first()).toBeVisible();

    // Go forward
    await page.locator('button:has-text("→")').click();
    await expect(page.locator("text=April").first()).toBeVisible();
  });

  test("clicking a day with worklogs shows detail panel", async ({ page }) => {
    // Click day 1 (which has worklogs in mock data)
    const dayCell = page.locator('.dc:has-text("1")').first();
    await dayCell.click();

    // Detail panel should show worklog entries
    await expect(page.locator("text=PROJ-101")).toBeVisible();
    await expect(
      page.locator("text=Implement user authentication flow")
    ).toBeVisible();
  });

  test("double-clicking a day navigates to daily worklog", async ({
    page,
  }) => {
    const dayCell = page.locator('.dc:has-text("1")').first();
    await dayCell.dblclick();
    await expect(page).toHaveURL(/\/daily-worklog\?day=2026-04-01/);
  });

  test("month summary statistics are displayed", async ({ page }) => {
    await expect(page.locator("text=MONTH TOTAL")).toBeVisible();
    await expect(page.locator("text=DAYS LOGGED")).toBeVisible();
    await expect(page.locator("text=AVG / DAY")).toBeVisible();
    await expect(page.getByText("TICKETS", { exact: true })).toBeVisible();
  });

  test("heat legend is visible", async ({ page }) => {
    await expect(page.locator("text=less → more")).toBeVisible();
  });

  test("logout returns to settings panel", async ({ page }) => {
    await page.locator('button:has-text("logout")').click();
    await expect(
      page.locator("text=Connect your Jira account to get started")
    ).toBeVisible();
  });

  test("today button navigates to current month", async ({ page }) => {
    // Navigate away from current month
    await page.locator('button:has-text("←")').click();
    await page.locator('button:has-text("←")').click();

    // Come back
    await page.locator('button:has-text("today")').click();
    const now = new Date();
    await expect(
      page.locator(`text=${MONTHS[now.getMonth()]}`).first()
    ).toBeVisible();
  });

  test("selecting a day then clicking again deselects", async ({ page }) => {
    const dayCell = page.locator('.dc:has-text("1")').first();
    await dayCell.click();
    await expect(page.locator("text=PROJ-101")).toBeVisible();

    // Click again to deselect
    await dayCell.click();
    await expect(page.locator("text=Select a day")).toBeVisible();
  });
});
