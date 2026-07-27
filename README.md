# Instax Multi User Print

Let a whole event print to Fujifilm Instax Bluetooth printers. Guests open a
web page on any phone (iPhone, Android, iPad, laptop — no app, no login),
upload a photo, pick a print size, and it comes out of the printer. The
operator gets a **control room** page with the full photo catalogue, live
printer health, and one-click reprints.

Tested with an **Instax Mini Link 3** (600×800 portrait) and an
**Instax Link Wide** (1260×840 landscape) driven from a Mac over Bluetooth LE.

## The two pages

**1. Guest page (cloud, works from any network)**
- Take a photo or choose from the library (in-browser compression keeps
  uploads fast)
- Pick Mini or Wide — shown as real instax-style frames with *your* photo
  cropped exactly as it will print
- Live printer status: on/off, film left, battery, out-of-film
- Queue tab with thumbnails, positions, and cancel buttons
- Print history

**2. Control room (runs on the operator's computer)**
- `http://127.0.0.1:8081` while the bridge is running
- Full catalogue of every uploaded photo (plus the failed pile) with
  print-again buttons per printer
- Live printer cards: connection, film, battery, queue, current job
- **Scan for printers and connect them to the Mini/Wide slots from the page**
  — no config editing needed

## How it works

```
guest phones ──> Vercel (Next.js) ──> Supabase Storage (queue)
                                          ▲   │
                                 status   │   │ jobs
                                          │   ▼
operator's computer:  bridge.py ──> Bluetooth LE ──> Instax printers
        │
        └── control room (Flask, localhost:8081) + ./photos archive
```

- Every upload is archived forever in `./photos/` on the operator's machine.
- Photos stay in the cloud queue (visible to guests) until they physically
  print; a persistent printed-log makes double prints impossible, even
  across restarts.
- A printer that's off, asleep, or out of film **pauses** its queue — photos
  wait, nothing is lost, and printing auto-resumes. BLE contact every 60s
  doubles as a keep-awake so printers never doze mid-event.
- Print completion is confirmed from the printer's own status codes
  (PRINTING → NORMAL + film count), not guessed with timers.
- Failures retry 3× with backoff, then park in `photos/failed/` — one click
  in the control room re-queues them.

There is also a fully offline mode (`app.py`): a local Flask server with a
QR code for guests on a shared hotspot — no cloud at all.

## Set up your own

You need: Python 3.10+, a free [Vercel](https://vercel.com) account, a free
[Supabase](https://supabase.com) project, and a computer with Bluetooth LE
near the printers (tested on macOS).

**1. Local install**

```bash
git clone https://github.com/akhilbhima/Instax-Multi-User-Print
cd Instax-Multi-User-Print
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

On macOS, grant your terminal Bluetooth permission:
**System Settings → Privacy & Security → Bluetooth → + → Terminal.**

**2. Supabase (photo queue storage)**

Create a project, then a **public storage bucket** named `nm-photoprints`
(or edit the bucket name in `cloud/lib/store.js`). Note your project URL and
`service_role` key.

**3. Deploy the guest page**

```bash
cd cloud && npm install
vercel link            # create/link a Vercel project
openssl rand -hex 24 > ../.agent-secret
cat ../.agent-secret | vercel env add AGENT_SECRET production
vercel env add SUPABASE_URL production              # your project URL
vercel env add SUPABASE_SERVICE_ROLE_KEY production # service_role key
vercel deploy --prod
```

Put your deployment URL in `config.py` as `CLOUD_URL`.

**4. Connect the printers and run**

```bash
python bridge.py
```

Open the control room at `http://127.0.0.1:8081`, turn the printers on,
click **Scan for printers**, and connect each one to a slot. Send one test
print per printer. Then share the guest page URL (or a QR of it) and you're
live.

## Field notes (learned the hard way)

- **An empty printer can report leftover film.** With no pack (or a spent
  one), Instax printers report the *previous* pack's count and accept the
  whole print job before erroring at the mechanical stage. This app reads
  the printer's real error/status bytes, but if prints "succeed" without
  paper appearing: check the film.
- A fresh pack reads 0 until the black cover sheet ejects (auto on load, or
  the bridge's REJECT_FILM_COVER handling).
- **A sleeping Instax turns Bluetooth off completely** — only its power
  button wakes it. Once awake, the bridge keeps it awake.
- The Link Wide wants ~150 ms between BLE data packets and a 1 s pause
  before the print command; the Mini tolerates 50 ms. Blasting faster gets
  polite ACKs and no prints.
- Keep the operator computer awake (`bridge.py` under `caffeinate` on
  macOS) and the printers charging.

## Config knobs (`config.py`)

| Setting | Meaning |
|---|---|
| `PRINT_ENABLED` | `False` = dry run: full BLE transfer, no actual print |
| `RETRIES` / `RETRY_BACKOFF_SECONDS` | retry behavior per photo |
| `AUTO_ROTATE_TO_FIT` | rotate 90° when photo/print orientations differ |
| `MAX_IMAGE_KB` | JPEG cap sent to the printer (printers reject >~105 KB) |
| `PACKET_DELAY` | per-model BLE pacing (see field notes) |
| `FILM_RECHECK_SECONDS` | out-of-film re-check cadence while paused |
| `FILM_IDLE_RECHECK_SECONDS` | idle film verify + keep-awake cadence |
| `ADMIN_HOST` / `ADMIN_PORT` | control room bind (default localhost:8081) |

## Credits

Bluetooth protocol built on [javl/InstaxBLE](https://github.com/javl/InstaxBLE)
(vendored in `vendor_instaxble/`), with protocol details from
[paorin/InstaxLink](https://github.com/paorin/InstaxLink) and
[dgwilson/ESP32-Instax-Bridge](https://github.com/dgwilson/ESP32-Instax-Bridge).
