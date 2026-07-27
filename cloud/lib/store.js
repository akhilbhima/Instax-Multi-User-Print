// Supabase Storage adapter — replaces Vercel Blob (free tier suspended us).
// Same model: the queue is files under queue/<fmt>/, status lives at
// status/current.json. Plain REST with the service key; no SDK needed.
// The key exists only in server-side env vars, never in the browser.

const BUCKET = "nm-photoprints";

function base() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return { url: url.replace(/\/$/, ""), key };
}

function authHeaders() {
  const { key } = base();
  return { Authorization: `Bearer ${key}`, apikey: key };
}

export function publicUrl(pathname) {
  const { url } = base();
  return `${url}/storage/v1/object/public/${BUCKET}/${pathname}`;
}

export async function putObject(pathname, body, contentType) {
  const { url } = base();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${pathname}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": contentType, "x-upsert": "true" },
    body,
  });
  if (!res.ok) throw new Error(`storage upload failed: ${res.status} ${await res.text()}`);
}

export async function deleteObject(pathname) {
  const { url } = base();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${pathname}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  // 400/404 on an already-deleted object is fine — deletion is idempotent here.
  if (!res.ok && res.status !== 404 && res.status !== 400) {
    throw new Error(`storage delete failed: ${res.status} ${await res.text()}`);
  }
}

// Returns [{pathname, uploadedAt, url}] under a prefix, oldest-first by name
// (names start with an ISO timestamp, so name order == print order).
export async function listObjects(prefix) {
  const { url } = base();
  const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      prefix,
      limit: 200,
      sortBy: { column: "name", order: "asc" },
    }),
  });
  if (!res.ok) throw new Error(`storage list failed: ${res.status} ${await res.text()}`);
  const items = await res.json();
  return items
    .filter((i) => i.id) // folders come back without an id
    .map((i) => {
      const pathname = `${prefix.replace(/\/$/, "")}/${i.name}`;
      return { pathname, uploadedAt: i.created_at, url: publicUrl(pathname) };
    });
}

// Server-side read (bypasses the public CDN, so never stale).
export async function readObject(pathname) {
  const { url } = base();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${pathname}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`storage read failed: ${res.status}`);
  return res.text();
}
