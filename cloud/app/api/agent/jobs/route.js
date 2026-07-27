import { listObjects } from "../../../../lib/store";
import { agentAuthorized } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

// The Mac bridge polls this for queued uploads (oldest first).
export async function GET(request) {
  if (!agentAuthorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const [mini, wide] = await Promise.all([
    listObjects("queue/mini/"),
    listObjects("queue/wide/"),
  ]);
  const jobs = [...mini, ...wide].sort((a, b) =>
    a.pathname.split("/").pop().localeCompare(b.pathname.split("/").pop()),
  );
  return Response.json({ ok: true, jobs });
}
