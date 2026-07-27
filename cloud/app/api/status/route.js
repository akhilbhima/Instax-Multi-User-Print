import { listObjects, readObject } from "../../../lib/store";

export const dynamic = "force-dynamic";

// Public status for the guest page: the Mac's last report (film, battery,
// pause state) plus the queued photos themselves for the Queue tab.
export async function GET() {
  const [statusText, miniQ, wideQ] = await Promise.all([
    readObject("status/current.json"),
    listObjects("queue/mini/"),
    listObjects("queue/wide/"),
  ]);

  let agent = null;
  if (statusText) {
    try {
      agent = JSON.parse(statusText);
      agent.stale =
        !agent.reported_at ||
        Date.now() - new Date(agent.reported_at).getTime() > 90 * 1000;
    } catch {
      agent = null;
    }
  }

  return Response.json({
    agent, // null until the Mac bridge has reported at least once
    cloud_queue: { mini: miniQ.length, wide: wideQ.length },
    queue: { mini: miniQ, wide: wideQ },
  });
}
