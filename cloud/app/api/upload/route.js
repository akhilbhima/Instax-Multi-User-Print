import { put, list } from "@vercel/blob";

export const dynamic = "force-dynamic";

const FORMATS = ["mini", "wide"];
const MAX_BYTES = 4 * 1024 * 1024; // stay under Vercel's 4.5 MB request cap

// Guests POST the (browser-compressed) JPEG as the raw request body:
//   POST /api/upload?format=mini
export async function POST(request) {
  const format = new URL(request.url).searchParams.get("format");
  if (!FORMATS.includes(format)) {
    return Response.json({ ok: false, error: "Pick Mini or Wide." }, { status: 400 });
  }

  const body = await request.arrayBuffer();
  if (!body || body.byteLength === 0) {
    return Response.json({ ok: false, error: "No photo received — try again." }, { status: 400 });
  }
  if (body.byteLength > MAX_BYTES) {
    return Response.json(
      { ok: false, error: "Photo too large — try again (it should compress automatically)." },
      { status: 413 },
    );
  }

  // Sortable timestamp key: the Mac prints oldest-first by pathname.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `queue/${format}/${stamp}-${rand}.jpg`;
  await put(key, body, {
    access: "public",
    addRandomSuffix: false,
    contentType: "image/jpeg",
  });

  const { blobs } = await list({ prefix: `queue/${format}/` });
  return Response.json({ ok: true, format, position: blobs.length });
}
