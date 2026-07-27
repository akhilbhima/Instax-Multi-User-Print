"""Configuration for instax-party-printer.

Run `python discover.py` with the printers turned on, then paste the two
device names below exactly as printed (the trailing "(IOS)" / "(ANDROID)"
suffix is optional — matching is by prefix).
"""

# --- Printer device names (from discover.py) ---------------------------------
MINI_PRINTER_NAME = "INSTAX-71028752"   # Instax Mini Link 3  (600x800 portrait)
WIDE_PRINTER_NAME = "INSTAX-20296765"   # Instax Link Wide    (1260x840 landscape)

# --- Print formats ------------------------------------------------------------
# width, height in pixels — these are fixed by the printer hardware.
FORMATS = {
    "mini": {"width": 600, "height": 800, "printer_name_key": "MINI_PRINTER_NAME"},
    "wide": {"width": 1260, "height": 840, "printer_name_key": "WIDE_PRINTER_NAME"},
}

# If an upload's orientation doesn't match the target format (e.g. a landscape
# photo sent to the portrait Mini), rotate it 90° before cropping so less of
# the photo is cut away. Set False to always crop without rotating.
AUTO_ROTATE_TO_FIT = True

# Max JPEG size sent to the printer, in KB. The printers reject larger files;
# InstaxBLE itself caps at 105 KB, we stay safely under that.
MAX_IMAGE_KB = 100

# --- Cloud mode (bridge.py) ---------------------------------------------------
CLOUD_URL = "https://nm-photoprints.vercel.app"

# --- Server -------------------------------------------------------------------
HOST = "0.0.0.0"
PORT = 8080
PHOTOS_DIR = "photos"           # permanent event archive — never deleted
FAILED_DIR = "photos/failed"    # originals that failed all print retries
PRINT_TMP_DIR = "photos/.print_tmp"  # prepared print files, deleted after use
MAX_UPLOAD_MB = 25

# --- Printing / retries -------------------------------------------------------
PRINT_ENABLED = True      # False = full dry run: transfers image but never prints
RETRIES = 3               # attempts per photo before moving it to failed/
RETRY_BACKOFF_SECONDS = [5, 15, 30]   # wait before attempt 2, 3, 4
CONNECT_TIMEOUT_SECONDS = 30          # BLE scan timeout per attempt
TRANSFER_TIMEOUT_SECONDS = 180        # max time for the image transfer
TRANSFER_STALL_SECONDS = 20           # abort if no packet progress for this long
POST_PRINT_WAIT_SECONDS = 20          # let the printer physically print/eject

# --- Film monitoring ----------------------------------------------------------
FILM_RECHECK_SECONDS = 30       # while out of film, re-check the printer this often
# Idle re-check doubles as the KEEP-AWAKE: each BLE connection resets the
# printer's ~10-min auto-sleep timer, so at 60s they never doze off during an
# event. (A printer that's ALREADY asleep stops advertising BLE and can only
# be woken with its power button — after that, this keeps it awake.)
FILM_IDLE_RECHECK_SECONDS = 60
LOW_FILM_THRESHOLD = 2          # console warning when film drops to this or fewer
STATUS_CONNECT_TIMEOUT_SECONDS = 15   # BLE scan timeout for a status-only check
