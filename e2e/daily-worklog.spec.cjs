const { test, expect } = require("@playwright/test");
const { injectCredentials, mockJiraAPIs } = require("./fixtures/test-helpers.cjs");

test.describe("Daily Worklog Page", () => {
  test.beforeEach(async ({ page }) => {
    await injectCredentials(page);
    await mockJiraAPIs(page);
  });

  test("renders clock visualization and worklog list", async ({ page }) => {
    await page.goto("/daily-worklog?day=2026-04-01");

    // Back button
    await expect(page.locator("text=← Calendar")).toBeVisible();

    // Date display
    await expect(page.getByText("April 1", { exact: true })).toBeVisible();

    // Clock SVG should render (Recharts PieChart)
    await expect(page.locator(".recharts-wrapper")).toBeVisible();
    await expect(page.getByText("10am", { exact: true })).toBeVisible();
    await expect(page.getByText("1pm", { exact: true })).toBeVisible();
    await expect(page.getByText("4pm", { exact: true })).toBeVisible();
    await expect(page.getByText("7pm", { exact: true })).toBeVisible();

    // Worklog entries
    await expect(page.locator("text=PROJ-101")).toBeVisible();
    await expect(page.locator("text=PROJ-102")).toBeVisible();
    await expect(
      page.locator("text=Implement user authentication flow")
    ).toBeVisible();
  });

  test("shows empty message for day with no worklogs", async ({ page }) => {
    await page.goto("/daily-worklog?day=2026-04-05");
    await expect(
      page.locator("text=No worklogs for this day.")
    ).toBeVisible();
  });

  test("day navigation works", async ({ page }) => {
    await page.goto("/daily-worklog?day=2026-04-01");

    // Navigate to next day
    await page.locator('button[aria-label="Next day"]').click();
    await expect(page).toHaveURL(/day=2026-04-02/);
    await expect(page.getByText("April 2", { exact: true })).toBeVisible();

    // Navigate back
    await page.locator('button[aria-label="Previous day"]').click();
    await expect(page).toHaveURL(/day=2026-04-01/);
  });

  test("back button returns to calendar", async ({ page }) => {
    await page.goto("/daily-worklog?day=2026-04-01");
    await page.locator("text=← Calendar").click();
    await page.waitForURL("**/");
    expect(page.url()).not.toContain("daily-worklog");
  });

  test("redirects to home when no credentials", async ({ page }) => {
    // Navigate WITHOUT injecting credentials (fresh context)
    const freshContext = await page.context().browser().newContext();
    const freshPage = await freshContext.newPage();

    // Mock the worklogs route to prevent real API calls
    await freshPage.route("**/api/jira/worklogs", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });

    await freshPage.goto("/daily-worklog?day=2026-04-01");
    await freshPage.waitForURL("**/");
    expect(freshPage.url()).not.toContain("daily-worklog");

    await freshContext.close();
  });

  test("clock center shows total logged time", async ({ page }) => {
    await page.goto("/daily-worklog?day=2026-04-01");
    // 4h + 2h = 6h total for April 1
    await expect(page.locator("text=6h").first()).toBeVisible();
    await expect(page.locator("text=logged today")).toBeVisible();
  });

  test("worklogs section shows entry count", async ({ page }) => {
    await page.goto("/daily-worklog?day=2026-04-01");
    // April 1 has 2 entries
    await expect(page.locator("text=2 entries")).toBeVisible();
  });
});
