"use client";

import { useEffect, useRef, useState } from "react";

const S = {
  body: {
    fontFamily: "-apple-system, system-ui, sans-serif",
    background: "#1c1a24", color: "#fff", minHeight: "100vh",
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", padding: 24, textAlign: "center",
  },
  step: { width: "100%", maxWidth: 420 },
  h1: { fontSize: "1.6rem", margin: "0 0 6px" },
  sub: { color: "#b9b4c7", margin: "0 0 16px" },
  film: { color: "#d9d4e7", fontSize: "0.9rem", marginBottom: 24, minHeight: "1.2em" },
  oof: { color: "#ff5d8f", fontWeight: 600 },
  btn: {
    display: "block", width: "100%", padding: 22, margin: "10px 0",
    fontSize: "1.25rem", fontWeight: 700, border: "none", borderRadius: 16,
    cursor: "pointer", WebkitTapHighlightColor: "transparent",
  },
  note: { fontSize: "0.85rem", fontWeight: 400, opacity: 0.85, display: "block", marginTop: 2 },
  preview: { maxWidth: "70%", maxHeight: "32vh", borderRadius: 12, margin: "12px auto", display: "block" },
  pos: { fontSize: "3rem", fontWeight: 800, color: "#ffb703" },
  err: { color: "#ff5d8f", marginTop: 12, minHeight: "1.2em" },
  spinner: {
    margin: "18px auto", width: 36, height: 36, borderRadius: "50%",
    border: "4px solid #444", borderTopColor: "#ffb703",
    animation: "spin 0.8s linear infinite",
  },
};

// Downscale + JPEG-encode in the browser so uploads stay under the server's
// 4 MB cap (phone photos are often 5-10 MB). 2000 px is far more than the
// printers' native resolution. Browsers apply EXIF orientation when drawing
// to canvas, so the output is upright.
async function compressPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read that photo"));
      i.src = url;
    });
    const maxDim = 2000;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (blob && blob.size > 0) return blob;
  } catch {
    // fall through to the original file (HEIC on old browsers etc.)
  } finally {
    URL.revokeObjectURL(url);
  }
  return file;
}

function printHistory(status) {
  if (!status || !status.agent) return { total: 0, recent: [] };
  const rows = [];
  let total = 0;
  for (const key of ["mini", "wide"]) {
    const p = status.agent[key];
    if (!p) continue;
    total += p.printed_count || 0;
    for (const h of p.history || []) {
      rows.push({ ...h, label: key === "mini" ? "Mini" : "Wide" });
    }
  }
  rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return { total, recent: rows.slice(0, 8) };
}

function filmLine(status) {
  if (!status || !status.agent || status.agent.stale) {
    return { text: "connecting to the printers…", oof: false };
  }
  const parts = [];
  let anyOof = false;
  for (const key of ["mini", "wide"]) {
    const p = status.agent[key];
    const label = key === "mini" ? "Mini" : "Wide";
    const cloudExtra = status.cloud_queue ? status.cloud_queue[key] || 0 : 0;
    if (!p) continue;
    if (p.out_of_film) {
      anyOof = true;
      // Blobs now stay queued until printed, so the cloud count IS the
      // full number of photos waiting.
      parts.push(`${label}: OUT OF FILM (queue paused, ${cloudExtra} waiting)`);
    } else if (p.film_left === null || p.film_left === undefined) {
      parts.push(`${label}: ready`);
    } else {
      parts.push(`${label}: ${p.film_left} print${p.film_left === 1 ? "" : "s"} left`);
    }
  }
  return { text: parts.join("  ·  "), oof: anyOof };
}

function QueueGrid({ status }) {
  const sections = [];
  for (const key of ["mini", "wide"]) {
    const items = (status && status.queue && status.queue[key]) || [];
    const current = status && status.agent && !status.agent.stale
      ? (status.agent[key] || {}).current : null;
    sections.push(
      <div key={key} style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>
          {key === "mini" ? "Mini" : "Wide"} queue
          {items.length === 0 ? " — empty" : ` — ${items.length} waiting`}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          {items.slice(0, 12).map((item, i) => {
            const base = item.pathname.split("/").pop();
            const printing = i === 0 && current && current.endsWith(base);
            return (
              <div key={item.pathname} style={{ position: "relative" }}>
                <img src={item.url} alt={`queued photo ${i + 1}`}
                     style={{ width: 104, height: 104, objectFit: "cover",
                              borderRadius: 10, display: "block",
                              border: printing ? "2px solid #ffb703" : "2px solid transparent" }} />
                <div style={{ position: "absolute", top: 4, left: 4,
                              background: printing ? "#ffb703" : "rgba(0,0,0,0.65)",
                              color: printing ? "#1c1a24" : "#fff",
                              borderRadius: 6, padding: "1px 7px",
                              fontSize: "0.75rem", fontWeight: 700 }}>
                  {printing ? "printing" : `#${i + 1}`}
                </div>
              </div>
            );
          })}
        </div>
        {items.length > 12 && (
          <div style={{ color: "#b9b4c7", fontSize: "0.85rem", marginTop: 6 }}>
            +{items.length - 12} more
          </div>
        )}
      </div>,
    );
  }
  return <div>{sections}</div>;
}

export default function Page() {
  const [step, setStep] = useState("pick"); // pick | format | sending | done
  const [tab, setTab] = useState("print");  // print | queue
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState(null);
  const inputRef = useRef(null);
  const cameraRef = useRef(null);
  const busyRef = useRef(false); // double-tap guard: one upload per photo, ever

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/status")
        .then((r) => r.json())
        .then((s) => alive && setStatus(s))
        .catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  function onPick(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setError("");
    setStep("format");
  }

  async function upload(format) {
    if (!file) { reset(); return; }
    if (busyRef.current) return;
    busyRef.current = true;
    setStep("sending");
    try {
      const blob = await compressPhoto(file);
      const res = await fetch(`/api/upload?format=${format}`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "Upload failed");
      const printer = status && status.agent && !status.agent.stale
        ? status.agent[format] : null;
      setResult({
        position: j.position,
        format,
        refilling: Boolean(printer && printer.out_of_film),
      });
      setStep("done");
    } catch (e) {
      setError(`${e.message} — try again?`);
      setStep("format");
    } finally {
      busyRef.current = false;
    }
  }

  function reset() {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
    setStep("pick");
  }

  const film = filmLine(status);
  const history = printHistory(status);
  const queueTotal = status && status.cloud_queue
    ? (status.cloud_queue.mini || 0) + (status.cloud_queue.wide || 0) : 0;

  return (
    <div style={S.body}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {step === "pick" && (
        <div style={S.step}>
          <h1 style={S.h1}>📸 NM Photoprints</h1>
          <p style={S.sub}>Snap or pick a photo — it prints right here at the party!</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 18 }}>
            {[["print", "Print"], ["queue", `Queue${queueTotal ? ` (${queueTotal})` : ""}`]].map(
              ([id, label]) => (
                <button key={id} onClick={() => setTab(id)}
                        style={{ padding: "8px 20px", borderRadius: 999, border: "none",
                                 fontWeight: 700, fontSize: "0.95rem", cursor: "pointer",
                                 background: tab === id ? "#ffb703" : "#2a2735",
                                 color: tab === id ? "#1c1a24" : "#b9b4c7" }}>
                  {label}
                </button>
              ),
            )}
          </div>
          <div style={{ ...S.film, ...(film.oof ? S.oof : {}) }}>{film.text}</div>
          {tab === "queue" && <QueueGrid status={status} />}
          {tab === "print" && <>

          <button style={{ ...S.btn, background: "#ffb703", color: "#1c1a24" }}
                  onClick={() => cameraRef.current && cameraRef.current.click()}>
            📷 Take a Photo
          </button>
          <button style={{ ...S.btn, background: "#2a2735", color: "#fff" }}
                  onClick={() => inputRef.current && inputRef.current.click()}>
            🖼 Choose from Library
          </button>
          {/* `capture` forces the camera; the second input omits it so the
              photo-library picker opens instead */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment"
                 style={{ display: "none" }} onChange={onPick} />
          <input ref={inputRef} type="file" accept="image/*"
                 style={{ display: "none" }} onChange={onPick} />

          {history.total > 0 && (
            <div style={{ marginTop: 28, color: "#b9b4c7", fontSize: "0.9rem" }}>
              <div style={{ fontWeight: 700, color: "#fff", marginBottom: 6 }}>
                🖨 {history.total} print{history.total === 1 ? "" : "s"} so far
              </div>
              {history.recent.map((h, i) => (
                <div key={i} style={{ padding: "2px 0" }}>
                  {h.at} · {h.label}
                </div>
              ))}
            </div>
          )}
          </>}
        </div>
      )}

      {step === "format" && (
        <div style={S.step}>
          <h1 style={S.h1}>Pick a print size</h1>
          {previewUrl && <img src={previewUrl} alt="your photo" style={S.preview} />}
          <button style={{ ...S.btn, background: "#ff5d8f", color: "#fff" }}
                  onClick={() => upload("mini")}>
            Mini <span style={S.note}>small &amp; tall — classic instax</span>
          </button>
          <button style={{ ...S.btn, background: "#4cc9f0", color: "#1c1a24" }}
                  onClick={() => upload("wide")}>
            Wide <span style={S.note}>big &amp; wide — group shots</span>
          </button>
          <div style={S.err}>{error}</div>
        </div>
      )}

      {step === "sending" && (
        <div style={S.step}>
          <h1 style={S.h1}>Sending…</h1>
          <div style={S.spinner} />
        </div>
      )}

      {step === "done" && result && (
        <div style={S.step}>
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 8px" }}>🎉 In the queue!</h1>
          <div style={S.pos}>#{result.position}</div>
          <p style={{ color: "#b9b4c7", margin: "8px 0 20px" }}>
            {result.refilling
              ? "Added to queue — this printer is being refilled, your photo will print shortly."
              : result.position === 1
                ? `Your photo is printing next on the ${result.format} printer!`
                : `position in the ${result.format} printer queue — hang tight!`}
          </p>
          <button style={{ ...S.btn, background: "#ffb703", color: "#1c1a24" }} onClick={reset}>
            Print Another
          </button>
        </div>
      )}
    </div>
  );
}
