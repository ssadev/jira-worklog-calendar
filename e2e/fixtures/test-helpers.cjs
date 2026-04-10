const { FAKE_CREDS, FAKE_WORKLOGS, FAKE_UNLOGGED, FAKE_MYSELF_RESPONSE } = require("./mock-data.cjs");

async function injectCredentials(page, creds = FAKE_CREDS) {
  await page.addInitScript((credsArg) => {
    window.localStorage.setItem("jira-worklog-creds", JSON.stringify(credsArg));
    window.localStorage.setItem(
      "jira-worklog-last-session",
      JSON.stringify(credsArg)
    );
  }, creds);
}

async function mockJiraAPIs(page, worklogs = FAKE_WORKLOGS, unlogged = FAKE_UNLOGGED) {
  await page.route("**/api/jira/myself", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FAKE_MYSELF_RESPONSE),
    });
  });

  await page.route("**/api/jira/worklogs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(worklogs),
    });
  });

  await page.route("**/api/jira/unlogged", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(unlogged),
    });
  });
}

async function mockMyselfError(page, status = 401, message = "Unauthorized") {
  await page.route("**/api/jira/myself", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ error: message }),
    });
  });
}

async function setupAuthenticatedPage(page, url = "/") {
  await injectCredentials(page);
  await mockJiraAPIs(page);
  await page.goto(url);
}

module.exports = {
  injectCredentials,
  mockJiraAPIs,
  mockMyselfError,
  setupAuthenticatedPage,
};
