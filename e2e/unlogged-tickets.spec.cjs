const { test, expect } = require("@playwright/test");
const {
  injectCredentials,
  mockJiraAPIs,
  setupAuthenticatedPage,
} = require("./fixtures/test-helpers.cjs");
const { FAKE_WORKLOGS } = require("./fixtures/mock-data.cjs");

test.describe("Unlogged Tickets", () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedPage(page, "/?month=2026-04");
  });

  test("stats bar shows UNLOGGED label with correct count", async ({ page }) => {
    await expect(page.locator("text=UNLOGGED").first()).toBeVisible();
    await expect(page.locator("text=2").first()).toBeVisible();
  });

  test("collapsible header is visible with badge count", async ({ page }) => {
    const header = page.locator("button", { hasText: "UNLOGGED TICKETS" });
    await expect(header).toBeVisible();
    await expect(header.locator("text=2")).toBeVisible();
  });

  test("clicking header expands and collapses the list", async ({ page }) => {
    const header = page.locator("button", { hasText: "UNLOGGED TICKETS" });

    // Initially collapsed — issue keys should not be visible
    await expect(page.locator("text=PROJ-200")).not.toBeVisible();

    // Expand
    await header.click();
    await expect(page.locator("text=PROJ-200")).toBeVisible();
    await expect(page.locator("text=PROJ-201")).toBeVisible();
    await expect(page.locator("text=Set up CI pipeline for staging")).toBeVisible();
    await expect(page.locator("text=Update README documentation")).toBeVisible();

    // Collapse
    await header.click();
    await expect(page.locator("text=PROJ-200")).not.toBeVisible();
  });

  test("expanded list shows issue status and metadata", async ({ page }) => {
    const header = page.locator("button", { hasText: "UNLOGGED TICKETS" });
    await header.click();

    await expect(page.locator("text=To Do").first()).toBeVisible();
    await expect(page.locator("text=In Progress").first()).toBeVisible();
  });
});

test.describe("Unlogged Tickets - empty state", () => {
  test("section is hidden when zero unlogged tickets", async ({ page }) => {
    await injectCredentials(page);
    await mockJiraAPIs(page, FAKE_WORKLOGS, { issues: [] });
    await page.goto("/?month=2026-04");

    // Stats bar should show "—" for unlogged
    await expect(page.locator("text=UNLOGGED").first()).toBeVisible();

    // Collapsible section should not exist
    const header = page.locator("button", { hasText: "UNLOGGED TICKETS" });
    await expect(header).not.toBeVisible();
  });
});
