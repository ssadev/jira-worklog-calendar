const FAKE_CREDS = {
  domain: "testcompany",
  email: "tester@testcompany.com",
  token: "fake-api-token-for-testing",
  accountId: "5f7e1b2c3d4e5f6a7b8c9d0e",
  displayName: "QA Tester",
};

const FAKE_WORKLOGS = {
  "2026-04-01": [
    {
      issueKey: "PROJ-101",
      issueSummary: "Implement user authentication flow",
      timeSpentSeconds: 14400, // 4h
      startedAt: "2026-04-01T09:00:00.000+0000",
      comment: "Set up OAuth2 integration",
    },
    {
      issueKey: "PROJ-102",
      issueSummary: "Write unit tests for auth module",
      timeSpentSeconds: 7200, // 2h
      startedAt: "2026-04-01T14:00:00.000+0000",
      comment: "",
    },
  ],
  "2026-04-02": [
    {
      issueKey: "PROJ-103",
      issueSummary: "Fix calendar rendering bug on Safari",
      timeSpentSeconds: 28800, // 8h
      startedAt: "2026-04-02T09:30:00.000+0000",
      comment: "Full day on this one",
    },
  ],
  "2026-04-07": [
    {
      issueKey: "PROJ-101",
      issueSummary: "Implement user authentication flow",
      timeSpentSeconds: 10800, // 3h
      startedAt: "2026-04-07T10:00:00.000+0000",
      comment: "Token refresh logic",
    },
  ],
  "2026-04-10": [
    {
      issueKey: "PROJ-104",
      issueSummary: "Add responsive breakpoints",
      timeSpentSeconds: 18000, // 5h
      startedAt: "2026-04-10T09:00:00.000+0000",
      comment: "",
    },
    {
      issueKey: "PROJ-105",
      issueSummary: "Review PR for dark mode",
      timeSpentSeconds: 3600, // 1h
      startedAt: "2026-04-10T15:00:00.000+0000",
      comment: "Looks good",
    },
  ],
};

const FAKE_UNLOGGED = {
  issues: [
    {
      key: "PROJ-200",
      summary: "Set up CI pipeline for staging",
      status: "To Do",
      issueType: "Task",
      project: "PROJ",
      updated: "2026-04-05T10:00:00.000+0000",
    },
    {
      key: "PROJ-201",
      summary: "Update README documentation",
      status: "In Progress",
      issueType: "Story",
      project: "PROJ",
      updated: "2026-04-09T15:30:00.000+0000",
    },
  ],
};

const FAKE_MYSELF_RESPONSE = {
  accountId: FAKE_CREDS.accountId,
  displayName: FAKE_CREDS.displayName,
};

module.exports = { FAKE_CREDS, FAKE_WORKLOGS, FAKE_UNLOGGED, FAKE_MYSELF_RESPONSE };
