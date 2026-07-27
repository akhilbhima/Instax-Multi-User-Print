import { del } from "@vercel/blob";
import { agentAuthorized } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

// The Mac bridge calls this after it has downloaded a job; the blob is
// deleted so it isn't handed out again. The Mac's photos/ folder is the
// archive from this point on.
export async function POST(request) {
  if (!agentAuthorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { url } = await request.json();
  if (!url || typeof url !== "string") {
    return Response.json({ ok: false, error: "url required" }, { status: 400 });
  }
  await del(url);
  return Response.json({ ok: true });
}
