import "server-only";

function normalizeDomain(domain) {
  return String(domain || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\.atlassian\.net\/?$/i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function assertRequired(value, field) {
  if (!value) {
    throw new Error(`${field} is required.`);
  }
}

function fmtError(status, statusText, body) {
  return `${status} ${statusText}${body ? `: ${body.slice(0, 160)}` : ""}`;
}

function lastDay(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function adfText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  return (node.content || []).map(adfText).filter(Boolean).join(" · ");
}

export function parseJiraCredentials(input) {
  const domain = normalizeDomain(input.domain);
  const email = String(input.email || "").trim();
  const token = String(input.token || "").trim();

  assertRequired(domain, "Jira domain");
  assertRequired(email, "Email");
  assertRequired(token, "API token");

  return { domain, email, token };
}

async function jiraCall(creds, path, options = {}) {
  const auth = Buffer.from(`${creds.email}:${creds.token}`).toString("base64");
  const url = `https://${creds.domain}.atlassian.net/rest/api/3${path}`;

  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Atlassian-Token": "no-check",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(fmtError(response.status, response.statusText, body));
  }

  return response.json();
}

export async function getMyself(creds) {
  return jiraCall(creds, "/myself");
}

export async function fetchMonthWorklogs(creds, accountId, year, month) {
  assertRequired(accountId, "accountId");

  const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const end = `${year}-${String(month + 1).padStart(2, "0")}-${lastDay(year, month)}`;
  const jql = `worklogDate >= "${start}" AND worklogDate <= "${end}" AND worklogAuthor = "${accountId}" ORDER BY updated DESC`;

  const issues = [];
  let nextPageToken = null;

  do {
    const body = {
      jql,
      maxResults: 50,
      fields: ["summary", "worklog", "key"],
      ...(nextPageToken ? { nextPageToken } : {}),
    };

    const data = await jiraCall(creds, "/search/jql", {
      method: "POST",
      body: JSON.stringify(body),
    });

    issues.push(...(data.issues || []));
    nextPageToken = data.isLast === false ? data.nextPageToken : null;
  } while (nextPageToken);

  const byDate = {};

  for (const issue of issues) {
    const worklogs = issue.fields?.worklog?.worklogs || [];

    for (const worklog of worklogs) {
      if (worklog.author?.accountId !== accountId) continue;

      const date = worklog.started?.slice(0, 10);
      if (!date || date < start || date > end) continue;

      const comment = adfText(worklog.comment)
        .replace(/\s*·\s*·(\s*·)*/g, " · ")
        .trim()
        .replace(/^·|·$/g, "")
        .trim();

      byDate[date] = byDate[date] || [];
      byDate[date].push({
        issueKey: issue.key,
        issueSummary: issue.fields.summary?.slice(0, 64) || "",
        timeSpentSeconds: worklog.timeSpentSeconds,
        startedAt: worklog.started || null,
        comment: comment.slice(0, 90),
      });
    }
  }

  return byDate;
}

export async function fetchUnloggedTickets(creds, accountId, year, month) {
  assertRequired(accountId, "accountId");

  const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const end = `${year}-${String(month + 1).padStart(2, "0")}-${lastDay(year, month)}`;
  const jql = `assignee = "${accountId}" AND updated >= "${start}" AND updated <= "${end}" AND timespent is EMPTY ORDER BY updated DESC`;

  const issues = [];
  let nextPageToken = null;

  do {
    const body = {
      jql,
      maxResults: 50,
      fields: ["summary", "issuetype", "status", "project", "updated"],
      ...(nextPageToken ? { nextPageToken } : {}),
    };

    const data = await jiraCall(creds, "/search/jql", {
      method: "POST",
      body: JSON.stringify(body),
    });

    issues.push(...(data.issues || []));
    nextPageToken = data.isLast === false ? data.nextPageToken : null;
  } while (nextPageToken);

  return {
    issues: issues.map((issue) => ({
      key: issue.key,
      summary: (issue.fields.summary || "").slice(0, 80),
      status: issue.fields.status?.name || "",
      issueType: issue.fields.issuetype?.name || "",
      project: issue.fields.project?.key || "",
      updated: issue.fields.updated || "",
    })),
  };
}
