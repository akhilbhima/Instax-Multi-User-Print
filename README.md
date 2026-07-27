# instax-party-printer

Guests at your event scan a QR code, upload a photo from their phone browser,
and it auto-prints on one of two Fujifilm Instax Bluetooth printers.

Two ways to run it:

- **Cloud mode (recommended):** guests use https://nm-photoprints.vercel.app
  from any network. Uploads land in Vercel Blob; `bridge.py` on the MacBook
  pulls them down, prints them, and pushes live film/queue status back so the
  page shows "Mini: 4 prints left · Wide: OUT OF FILM". See *Cloud mode* below.
- **Offline mode:** `app.py` hosts the page locally on a phone hotspot —
  no internet needed at all.

- **Mini** queue → Instax Mini Link 3 (600×800 portrait)
- **Wide** queue → Instax Link Wide (1260×840 landscape)
- Every upload is archived forever in `./photos/`
- Failed prints (after 3 retries) land in `./photos/failed/` — re-queue them
  later by re-uploading
- **Film monitoring:** film + battery are read from the printer before every
  print. Out of film pauses that queue (nothing is lost), the printer is
  re-checked every 30 s, and printing auto-resumes once you reload. Both the
  upload page and `/status` show live film counts; the console warns when a
  printer drops to ≤2 prints so you can grab a refill pack early.

## How it works

`app.py` runs a Flask server on port 8080 with a mobile upload page. Each
upload is saved to `./photos/` with a timestamp name and dropped onto one of
two print queues. A background worker per printer prepares the image with
Pillow (EXIF auto-rotate → rotate-to-fit → center-crop → exact resize → JPEG
under 100 KB) and prints it over Bluetooth LE using the vendored
[InstaxBLE](https://github.com/javl/InstaxBLE) library
(`vendor_instaxble/`). Failures retry 3× with backoff, then the photo moves to
`photos/failed/` and the queue keeps moving.

## macOS setup (one time)

1. **Create a venv and install dependencies** (Python 3.10+):

   ```bash
   cd instax-party-printer
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Grant Terminal Bluetooth permission.** Open
   **System Settings → Privacy & Security → Bluetooth**, click **+**, and add
   **Terminal** (or iTerm, if that's what you use). If macOS pops a Bluetooth
   permission dialog the first time you run a script instead, just click
   **Allow** — then re-run the script.

3. **Turn on both printers** (press the power button; wait for the LED).
   Don't pair them in macOS Bluetooth settings — the app talks to them
   directly over BLE.

4. **Find the printers' device names:**

   ```bash
   python discover.py
   ```

   You'll see something like:

   ```
   Found 2 Instax printer(s):
     INSTAX-50123456(IOS)   [FA:AB:BC:12:34:56]
     INSTAX-70654321(IOS)   [FA:AB:BC:65:43:21]
   ```

   Not sure which is which? Turn one printer off and scan again.

5. **Paste the names into `config.py`:**

   ```python
   MINI_PRINTER_NAME = "INSTAX-50123456"   # the Mini Link 3
   WIDE_PRINTER_NAME = "INSTAX-70654321"   # the Link Wide
   ```

   The `(IOS)` suffix is optional — matching is by prefix.

## Cloud mode (nm-photoprints.vercel.app)

The cloud app lives in `cloud/` (Next.js + Vercel Blob, project
`nm-photoprints` on Vercel). The guest page compresses photos in the browser
(~2000 px JPEG) before uploading, so uploads are fast and stay under Vercel's
4 MB request cap.

To run an event:

1. Do the one-time setup above (steps 1–5), so printer names are in
   `config.py`.
2. Make sure the Mac has internet and Bluetooth on, printers on, then:

   ```bash
   source venv/bin/activate
   python bridge.py
   ```

3. Guests open **https://nm-photoprints.vercel.app** — QR it, AirDrop it,
   put it on a screen. The page shows live film counts and queue state.

The bridge authenticates with the secret in `.agent-secret` (git-ignored),
which must match the `AGENT_SECRET` env var on the Vercel project. To
redeploy the cloud app after changes: `cd cloud && vercel deploy --prod`.

If the Mac bridge is offline, guests can still upload — jobs wait safely in
the cloud queue and print as soon as `bridge.py` comes back. The page shows
"connecting to the printers…" until the bridge's first status report.

## Offline mode (local hotspot)

1. Connect the MacBook's Wi-Fi to the **phone hotspot** you'll use at the
   event (guests join the same hotspot).

2. Start the server:

   ```bash
   source venv/bin/activate
   python app.py
   ```

   The terminal shows the upload URL, an ASCII QR code, and saves `qr.png`
   (print it or leave it on a screen for guests).

3. **Test one print per printer before the event:** open the URL on your
   phone, upload a photo as *Mini*, then another as *Wide*. Watch the
   terminal log and confirm both physical prints come out. The status page at
   `http://<mac-ip>:8080/status` shows queue lengths and the last 5 prints.

## During the event

- Keep the printers **charged and within ~5 m** of the MacBook.
- **Out of film?** The queue pauses automatically — a big `OUT OF FILM` banner
  appears in the terminal and on `/status`, and guests still upload as normal
  (they're told the printer is being refilled). Reload film and the queue
  resumes by itself within ~30 s. No photos are lost or discarded.
- Watch the terminal for the `LOW FILM` warning (≤2 prints left) so you can
  have the next film pack ready before it runs dry.
- Everything is logged to the terminal. `./photos/` is your complete event
  archive — never deleted by the app.

## Config knobs (`config.py`)

| Setting | Meaning |
|---|---|
| `PRINT_ENABLED` | `False` = dry run: full BLE transfer, no actual print |
| `RETRIES` / `RETRY_BACKOFF_SECONDS` | retry behavior per photo |
| `AUTO_ROTATE_TO_FIT` | rotate 90° when photo/print orientations differ (less cropping) |
| `MAX_IMAGE_KB` | JPEG cap sent to the printer (printers reject >~105 KB) |
| `POST_PRINT_WAIT_SECONDS` | pause after transfer so the print ejects before disconnect |
| `FILM_RECHECK_SECONDS` | how often a paused (out-of-film) queue re-checks the printer |
| `LOW_FILM_THRESHOLD` | console warning when film drops to this many prints |

## Troubleshooting

- **`No bluetooth adapters found`** → Bluetooth is off, or Terminal lacks the
  Bluetooth permission (step 2).
- **Printer never found** → it auto-sleeps after ~10 min idle; press its power
  button. Also make sure no phone app (Instax app!) is connected to it —
  the printers accept only one BLE connection at a time.
- **Guests can't load the page** → they're not on the same hotspot, or the
  hotspot has "isolate clients" enabled (use a phone hotspot, not a router
  guest network).
- **Prints look cropped** → that's the center-crop to the fixed print aspect
  ratio; it's unavoidable, but `AUTO_ROTATE_TO_FIT` keeps as much as possible.
