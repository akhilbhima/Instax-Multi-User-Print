"use client";

import { useEffect, useRef, useState } from "react";

const CSS = `
:root {
  --green: #8CC63E;
  --leaf: #4C7A1B;
  --ink: #131512;
  --mist: #6A716B;
  --chalk: #F4F6F1;
  --line: #E4E7E0;
  --clay: #BF4430;
}
* { box-sizing: border-box; }
.page {
  font-family: var(--font-body), system-ui, sans-serif;
  color: var(--ink);
  min-height: 100vh;
  display: flex; flex-direction: column; align-items: center;
  padding: 28px 20px 40px;
  text-align: center;
}
.step { width: 100%; max-width: 430px; }

/* header */
.eyebrow {
  font-size: 0.72rem; letter-spacing: 0.28em; color: var(--leaf);
  font-weight: 600; text-transform: uppercase; margin-bottom: 4px;
}
.title {
  font-family: var(--font-display), sans-serif;
  font-size: 2.1rem; line-height: 1; margin: 0 0 6px;
  text-transform: uppercase; letter-spacing: 0.01em;
}
.title .dot { color: var(--green); }
.sub { color: var(--mist); margin: 0 0 18px; font-size: 0.95rem; }

/* printer status chips */
.chips { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-bottom: 4px; }
.chip {
  display: inline-flex; align-items: center; gap: 7px;
  background: var(--chalk); border-radius: 999px;
  padding: 7px 14px; font-size: 0.82rem; font-weight: 600; color: var(--ink);
}
.chip .led { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.led.ok { background: var(--green); }
.led.warn { background: #E0A800; }
.led.bad { background: var(--clay); }
.led.dim { background: #C6CCC4; }
.chip.trouble { color: var(--clay); }
.batt { color: var(--mist); font-size: 0.74rem; margin: 6px 0 20px; min-height: 1em; }

/* tabs */
.tabs { display: flex; gap: 8px; justify-content: center; margin-bottom: 20px; }
.tab {
  padding: 8px 22px; border-radius: 999px; border: none; cursor: pointer;
  font-family: var(--font-body), sans-serif; font-weight: 700; font-size: 0.9rem;
  background: transparent; color: var(--mist); border: 2px solid var(--line);
}
.tab.on { background: var(--ink); color: #fff; border-color: var(--ink); }

/* buttons */
.btn {
  display: block; width: 100%; padding: 20px; margin: 10px 0;
  font-family: var(--font-body), sans-serif;
  font-size: 1.15rem; font-weight: 700; border: none; border-radius: 16px;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
  transition: transform 0.08s ease;
}
.btn:active { transform: scale(0.98); }
.btn.primary { background: var(--green); color: var(--ink); }
.btn.quiet { background: #fff; color: var(--ink); border: 2.5px solid var(--ink); }
button:focus-visible { outline: 3px solid var(--leaf); outline-offset: 2px; }

/* instax frames — the signature */
.frame {
  background: #fff; border: 1px solid var(--line); border-radius: 4px;
  box-shadow: 0 12px 28px rgba(19, 21, 18, 0.14);
  padding: 7px 7px 0;
}
.frame img { display: block; width: 100%; border-radius: 2px; object-fit: cover; background: var(--chalk); }
.frame .chin {
  font-family: var(--font-display), sans-serif;
  text-transform: uppercase; letter-spacing: 0.08em;
  padding: 7px 0 9px; font-size: 0.95rem;
}

/* format chooser: your photo inside each real print shape */
.formats { display: flex; gap: 18px; align-items: flex-end; justify-content: center; margin: 22px 0 6px; }
.format-btn { background: none; border: none; padding: 0; cursor: pointer; }
.format-btn .frame { transition: transform 0.15s ease; }
.format-btn.mini .frame { width: 138px; transform: rotate(-2deg); }
.format-btn.wide .frame { width: 212px; transform: rotate(1.4deg); }
.format-btn:hover .frame, .format-btn:focus-visible .frame { transform: rotate(0deg) translateY(-4px); }
.format-btn.mini img { aspect-ratio: 3 / 4; }
.format-btn.wide img { aspect-ratio: 3 / 2; }
.format-note { color: var(--mist); font-size: 0.8rem; margin-top: 10px; }

/* sending: a print ejecting from the slot */
.eject-stage { height: 150px; width: 150px; margin: 26px auto 0; position: relative; overflow: hidden; }
.eject-stage .frame { width: 108px; position: absolute; left: 21px; bottom: -8px;
  animation: eject 1.5s ease-in-out infinite; }
.eject-stage img { aspect-ratio: 3 / 4; }
.slot { width: 190px; height: 14px; background: var(--ink); border-radius: 7px; margin: -4px auto 0; position: relative; z-index: 2; }
@keyframes eject {
  0% { transform: translateY(112%); }
  70% { transform: translateY(12%); }
  100% { transform: translateY(10%); }
}

/* done: the green circle stamp */
.stamp {
  width: 132px; height: 132px; border-radius: 50%; background: var(--green);
  color: var(--ink); display: flex; align-items: center; justify-content: center;
  margin: 16px auto 10px;
  font-family: var(--font-display), sans-serif; font-size: 2.6rem;
  animation: pop 0.4s cubic-bezier(0.2, 1.6, 0.4, 1) both;
}
@keyframes pop { from { transform: scale(0.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.done-note { color: var(--mist); margin: 6px 0 22px; }

/* queue tab */
.q-section { margin-bottom: 26px; }
.q-head {
  font-family: var(--font-display), sans-serif; text-transform: uppercase;
  font-size: 1rem; letter-spacing: 0.06em; margin-bottom: 12px;
}
.q-head .count { color: var(--leaf); }
.q-grid { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
.q-item { position: relative; }
.q-item .frame { padding: 5px 5px 0; box-shadow: 0 6px 16px rgba(19, 21, 18, 0.12); }
.q-item.mini .frame { width: 88px; } .q-item.mini img { aspect-ratio: 3 / 4; }
.q-item.wide .frame { width: 126px; } .q-item.wide img { aspect-ratio: 3 / 2; }
.q-item .chin { font-size: 0.72rem; padding: 4px 0 6px; }
.q-item.printing .frame { outline: 3px solid var(--green); }
.q-item.printing .chin { color: var(--leaf); }
.q-cancel {
  position: absolute; top: -8px; right: -8px; width: 26px; height: 26px;
  border-radius: 50%; border: 2px solid #fff; background: var(--ink); color: #fff;
  font-weight: 800; font-size: 0.8rem; line-height: 1; cursor: pointer;
}
.q-empty { color: var(--mist); font-size: 0.9rem; }
.more { color: var(--mist); font-size: 0.85rem; margin-top: 10px; }

/* history */
.history { margin-top: 30px; border-top: 1px solid var(--line); padding-top: 16px; }
.history .lead { font-weight: 700; margin-bottom: 6px; }
.history .lead b { color: var(--leaf); }
.history .row { color: var(--mist); font-size: 0.85rem; padding: 2px 0; }

.err { color: var(--clay); margin-top: 12px; min-height: 1.2em; font-size: 0.9rem; }

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
`;

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

function printerChips(status) {
  const chips = [];
  const batts = [];
  if (!status || !status.agent || status.agent.stale) {
    return { chips: [{ led: "dim", text: "Connecting to the printers…" }], batt: "" };
  }
  for (const key of ["mini", "wide"]) {
    const p = status.agent[key];
    if (!p) continue;
    const label = key === "mini" ? "Mini" : "Wide";
    const cloudCount = status.cloud_queue ? status.cloud_queue[key] || 0 : 0;
    if (!p.online) {
      chips.push({ led: "bad", text: `${label} · off — press its power button`, trouble: true });
    } else if (p.out_of_film) {
      chips.push({ led: "warn", text: `${label} · out of film · ${cloudCount} waiting`, trouble: true });
    } else if (p.film_left === null || p.film_left === undefined) {
      chips.push({ led: "ok", text: `${label} · ready` });
    } else {
      chips.push({ led: "ok", text: `${label} · ${p.film_left} left` });
    }
    if (p.online && p.battery !== null && p.battery !== undefined) {
      batts.push(`${label} ${p.battery}%`);
    }
  }
  return { chips, batt: batts.length ? `battery ${batts.join(" · ")}` : "" };
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
  return { total, recent: rows.slice(0, 6) };
}

function QueueGrid({ status, onCancel }) {
  const sections = [];
  for (const key of ["mini", "wide"]) {
    const items = (status && status.queue && status.queue[key]) || [];
    const current = status && status.agent && !status.agent.stale
      ? (status.agent[key] || {}).current : null;
    sections.push(
      <div key={key} className="q-section">
        <div className="q-head">
          {key === "mini" ? "Mini" : "Wide"}{" "}
          {items.length > 0 && <span className="count">· {items.length} waiting</span>}
        </div>
        {items.length === 0 ? (
          <div className="q-empty">Nothing waiting — your photo could be next.</div>
        ) : (
          <div className="q-grid">
            {items.slice(0, 12).map((item, i) => {
              const base = item.pathname.split("/").pop();
              const printing = i === 0 && current && current.endsWith(base);
              return (
                <div key={item.pathname}
                     className={`q-item ${key}${printing ? " printing" : ""}`}>
                  <div className="frame">
                    <img src={item.url} alt={`queued photo ${i + 1}`} />
                    <div className="chin">{printing ? "printing…" : `#${i + 1}`}</div>
                  </div>
                  {!printing && (
                    <button className="q-cancel" aria-label="cancel this photo"
                            onClick={() => onCancel(item.pathname)}>
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {items.length > 12 && <div className="more">+{items.length - 12} more</div>}
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

  const loadStatus = () =>
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 10000);
    return () => clearInterval(t);
  }, []);

  async function cancelQueued(pathname) {
    try {
      await fetch("/api/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathname }),
      });
    } catch {}
    loadStatus();
  }

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

  const { chips, batt } = printerChips(status);
  const history = printHistory(status);
  const queueTotal = status && status.cloud_queue
    ? (status.cloud_queue.mini || 0) + (status.cloud_queue.wide || 0) : 0;

  return (
    <div className="page">
      <style>{CSS}</style>

      <h1 className="title">Photo<span className="dot">·</span>Prints</h1>

      {step === "pick" && (
        <div className="step">
          <p className="sub">Take a photo, pick a size, grab your print.</p>

          <div className="chips">
            {chips.map((c, i) => (
              <span key={i} className={`chip${c.trouble ? " trouble" : ""}`}>
                <i className={`led ${c.led}`} />{c.text}
              </span>
            ))}
          </div>
          <div className="batt">{batt}</div>

          <div className="tabs">
            {[["print", "Print"], ["queue", `Queue${queueTotal ? ` · ${queueTotal}` : ""}`]].map(
              ([id, label]) => (
                <button key={id} className={`tab${tab === id ? " on" : ""}`}
                        onClick={() => setTab(id)}>
                  {label}
                </button>
              ),
            )}
          </div>

          {tab === "queue" && <QueueGrid status={status} onCancel={cancelQueued} />}

          {tab === "print" && (
            <>
              <button className="btn primary"
                      onClick={() => cameraRef.current && cameraRef.current.click()}>
                Take a photo
              </button>
              <button className="btn quiet"
                      onClick={() => inputRef.current && inputRef.current.click()}>
                Choose from library
              </button>
              {/* `capture` forces the camera; the second input omits it so the
                  photo-library picker opens instead */}
              <input ref={cameraRef} type="file" accept="image/*" capture="environment"
                     style={{ display: "none" }} onChange={onPick} />
              <input ref={inputRef} type="file" accept="image/*"
                     style={{ display: "none" }} onChange={onPick} />

              {history.total > 0 && (
                <div className="history">
                  <div className="lead">
                    🖨 <b>{history.total}</b> print{history.total === 1 ? "" : "s"} so far tonight
                  </div>
                  {history.recent.map((h, i) => (
                    <div key={i} className="row">{h.at} · {h.label}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {step === "format" && (
        <div className="step">
          <p className="sub">Pick your print — this is how each one crops.</p>
          <div className="formats">
            <button className="format-btn mini" onClick={() => upload("mini")}>
              <div className="frame">
                {previewUrl && <img src={previewUrl} alt="your photo as a Mini print" />}
                <div className="chin">Mini</div>
              </div>
            </button>
            <button className="format-btn wide" onClick={() => upload("wide")}>
              <div className="frame">
                {previewUrl && <img src={previewUrl} alt="your photo as a Wide print" />}
                <div className="chin">Wide</div>
              </div>
            </button>
          </div>
          <div className="format-note">Tap a print to send it</div>
          <div className="err">{error}</div>
        </div>
      )}

      {step === "sending" && (
        <div className="step">
          <p className="sub">Sending to the printer…</p>
          <div className="eject-stage">
            <div className="frame">
              {previewUrl && <img src={previewUrl} alt="" />}
              <div className="chin">&nbsp;</div>
            </div>
          </div>
          <div className="slot" />
        </div>
      )}

      {step === "done" && result && (
        <div className="step">
          <div className="stamp">{result.position === 1 ? "✓" : `#${result.position}`}</div>
          <p className="done-note">
            {result.refilling
              ? "Added to the queue — this printer is being refilled, your photo will print shortly."
              : result.position === 1
                ? `Printing now on the ${result.format} printer — watch for it!`
                : `You're #${result.position} in the ${result.format} queue — hang tight.`}
          </p>
          <button className="btn primary" onClick={reset}>Print another photo</button>
        </div>
      )}
    </div>
  );
}
