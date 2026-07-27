import { put, del, list } from "@vercel/blob";
import { agentAuthorized } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

// The Mac bridge pushes printer status (film, battery, queues) every ~15 s.
// Each push writes a new pathname so the guest page never reads a CDN-cached
// stale copy; older reports are cleaned up after.
export async function POST(request) {
  if (!agentAuthorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = await request.text();
  try {
    JSON.parse(body);
  } catch {
    return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const key = `status/${Date.now()}.json`;
  await put(key, body, {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });

  const { blobs } = await list({ prefix: "status/" });
  await Promise.all(
    blobs.filter((b) => b.pathname !== key).map((b) => del(b.url).catch(() => {})),
  );
  return Response.json({ ok: true });
}
