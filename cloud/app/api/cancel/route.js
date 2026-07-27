import { deleteObject } from "../../../lib/store";

export const dynamic = "force-dynamic";

// Guests can remove a photo from the queue (party-trust model — no auth,
// same as uploading). Only `queue/` objects can be touched. The Mac bridge
// notices the object is gone and skips the job if it hasn't started printing.
export async function POST(request) {
  const { pathname } = await request.json();
  if (!pathname || typeof pathname !== "string" || !pathname.startsWith("queue/")) {
    return Response.json({ ok: false, error: "invalid pathname" }, { status: 400 });
  }
  await deleteObject(pathname);
  return Response.json({ ok: true });
}
