"""Scan for nearby Instax printers and print their names.

Turn the printers ON first, then run:  python discover.py
Paste the reported names into config.py.
"""

import sys

import simplepyble

SCAN_SECONDS = 6


def main():
    adapters = simplepyble.Adapter.get_adapters()
    if not adapters:
        sys.exit("No Bluetooth adapter found. Is Bluetooth on? "
                 "Did you grant Terminal Bluetooth permission in "
                 "System Settings > Privacy & Security > Bluetooth?")
    adapter = adapters[0]
    print(f"Scanning for {SCAN_SECONDS}s on adapter "
          f"{adapter.identifier() or 'default'} ... (printers must be ON)")
    adapter.scan_for(SCAN_SECONDS * 1000)

    instax, other_named = [], 0
    for p in adapter.scan_get_results():
        name = p.identifier()
        if name.startswith("INSTAX"):
            instax.append((name, p.address(), p.is_connectable()))
        elif name:
            other_named += 1

    if not instax:
        print(f"\nNo Instax printers found ({other_named} other BLE devices seen).")
        print("Make sure each printer is turned on (LED lit) and close by, "
              "then run this again.")
        return

    print(f"\nFound {len(instax)} Instax printer(s):\n")
    for name, address, connectable in instax:
        note = "" if connectable else "   (currently not connectable!)"
        print(f"  {name}   [{address}]{note}")
    print("\nPaste the names into config.py:")
    print('  MINI_PRINTER_NAME = "<name of the Mini Link 3>"')
    print('  WIDE_PRINTER_NAME = "<name of the Link Wide>"')


if __name__ == "__main__":
    main()
