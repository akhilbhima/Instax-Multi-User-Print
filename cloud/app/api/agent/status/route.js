import { putObject } from "../../../../lib/store";
import { agentAuthorized } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

// The Mac bridge pushes printer status every ~15 s. Single overwritten
// object; /api/status reads it server-side so CDN caching never applies.
export async function POST(request) {
  if (!agentAuthorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let payload;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  payload.reported_at = new Date().toISOString();
  await putObject("status/current.json", JSON.stringify(payload), "application/json");
  return Response.json({ ok: true });
}
