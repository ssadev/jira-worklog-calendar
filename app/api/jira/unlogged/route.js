import { fetchUnloggedTickets, parseJiraCredentials } from "@/lib/jira";

export async function POST(request) {
  try {
    const payload = await request.json();
    const creds = parseJiraCredentials(payload);
    const accountId = String(payload.accountId || "").trim();
    const year = Number(payload.year);
    const month = Number(payload.month);

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) {
      throw new Error("A valid year and zero-based month are required.");
    }

    const result = await fetchUnloggedTickets(creds, accountId, year, month);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message || "Failed to load unlogged tickets." }, { status: 400 });
  }
}
