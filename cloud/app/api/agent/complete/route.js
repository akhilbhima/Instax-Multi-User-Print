import { deleteObject } from "../../../../lib/store";
import { agentAuthorized } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

// The Mac bridge calls this once a job is printed (or permanently failed);
// removing the object takes it off the guest page's Queue tab. The Mac's
// photos/ folder is the archive.
export async function POST(request) {
  if (!agentAuthorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { pathname } = await request.json();
  if (!pathname || typeof pathname !== "string" || !pathname.startsWith("queue/")) {
    return Response.json({ ok: false, error: "pathname required" }, { status: 400 });
  }
  await deleteObject(pathname);
  return Response.json({ ok: true });
}
