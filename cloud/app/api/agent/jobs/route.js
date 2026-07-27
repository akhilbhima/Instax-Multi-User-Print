import { list } from "@vercel/blob";
import { agentAuthorized } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

// The Mac bridge polls this for queued uploads (oldest first).
export async function GET(request) {
  if (!agentAuthorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { blobs } = await list({ prefix: "queue/" });
  const jobs = blobs
    .map((b) => ({ pathname: b.pathname, url: b.url, uploadedAt: b.uploadedAt }))
    .sort((a, b) => a.pathname.localeCompare(b.pathname));
  return Response.json({ ok: true, jobs });
}
