import { list } from "@vercel/blob";

export const dynamic = "force-dynamic";

// Public status for the guest page: the Mac's last report (film, battery,
// pause state) plus how many uploads are still in the cloud queue. Status
// reports use a fresh pathname each push, so blob URLs are never CDN-stale.
export async function GET() {
  const [statusList, miniQ, wideQ] = await Promise.all([
    list({ prefix: "status/" }),
    list({ prefix: "queue/mini/" }),
    list({ prefix: "queue/wide/" }),
  ]);

  let agent = null;
  if (statusList.blobs.length > 0) {
    const latest = statusList.blobs.reduce((a, b) =>
      new Date(a.uploadedAt) > new Date(b.uploadedAt) ? a : b,
    );
    try {
      const res = await fetch(latest.url, { cache: "no-store" });
      agent = await res.json();
      agent.reported_at = latest.uploadedAt;
      agent.stale =
        Date.now() - new Date(latest.uploadedAt).getTime() > 90 * 1000;
    } catch {
      agent = null;
    }
  }

  // Oldest-first = print order (pathnames start with an ISO timestamp).
  const queueItems = (blobs) =>
    blobs
      .sort((a, b) => a.pathname.localeCompare(b.pathname))
      .map((b) => ({ url: b.url, pathname: b.pathname, uploadedAt: b.uploadedAt }));

  return Response.json({
    agent, // null until the Mac bridge has reported at least once
    cloud_queue: { mini: miniQ.blobs.length, wide: wideQ.blobs.length },
    queue: { mini: queueItems(miniQ.blobs), wide: queueItems(wideQ.blobs) },
  });
}
