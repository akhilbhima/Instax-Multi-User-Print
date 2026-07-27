import { del, list } from "@vercel/blob";

export const dynamic = "force-dynamic";

// Guests can remove a photo from the queue (party-trust model — no auth,
// same as uploading). Only `queue/` blobs can be touched. The Mac bridge
// notices the blob is gone and skips the job if it hasn't started printing.
export async function POST(request) {
  const { pathname } = await request.json();
  if (!pathname || typeof pathname !== "string" || !pathname.startsWith("queue/")) {
    return Response.json({ ok: false, error: "invalid pathname" }, { status: 400 });
  }
  const { blobs } = await list({ prefix: pathname });
  const match = blobs.find((b) => b.pathname === pathname);
  if (match) await del(match.url);
  return Response.json({ ok: true });
}
