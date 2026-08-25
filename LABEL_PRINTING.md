# GotCracked Portal 1.0 — DYMO label workflow

## Target printer

GotCracked is targeting a **DYMO LabelWriter 550 Turbo** for production label printing.

The 550 Turbo can be used from a workstation over USB or placed on the shop LAN using its Ethernet connection. Install the current **DYMO Connect for Desktop** software on every workstation that will print to it. Portal itself continues to use the browser/OS print path rather than receiving unrestricted printer access.

The LabelWriter 550 series uses automatic label recognition and requires compatible authentic DYMO-branded label stock. Before production commissioning, verify the exact roll loaded in the printer and match the Portal label template to that stock.

## What Portal prints

### 1. Work-order / device label

Print after a physical intake is completed, or from an open work order at any later time.

The label contains:

- GotCracked branding
- Work-order number (for example `GC-000123`)
- Customer name
- Device description
- A Code 39 barcode containing the **work-order number**
- Customer phone only when that setting is explicitly enabled

Attach the label to the repair bag, tote, bin, or intake container — **not directly to the customer device**.

The same work-order barcode is used at the bench and in **Ready for Pickup**. Scanning it should resolve the exact work order rather than encoding a status value.

### 2. Inventory / part label

Inventory labels contain:

- Part name
- GotCracked SKU
- Category
- Code 39 SKU barcode
- Retail price when enabled in Settings

A technician can scan that barcode into the Parts & Services search on a work order. Management can also print or reprint an inventory label from Inventory.

### 3. Purchase-order receiving labels

Portal purchase orders document external supplier orders from sources such as **MobileSentrix, Amazon, and other vendors** even when the supplier does not provide a direct inventory API integration.

Receiving flow:

1. Open the PO in Portal.
2. Enter the quantity received for each PO line.
3. Portal increases inventory for the received quantity and records partial/full PO receipt status.
4. When receiving is saved, Portal offers to print DYMO SKU labels for the newly received quantity.
5. The number of printed labels should normally match the quantity physically received.

This makes Portal the inventory/audit bridge between external purchasing and GotCracked stock records.

### 4. Training Store labels

Training Store is an isolated sandbox. Fake customers, leads, work orders, POs, inventory movements, and sales remain in local browser storage and do not write to production.

Training Store can still generate labels so staff can practice:

- Work-order barcode printing
- Barcode scanning into a work order
- PO receiving
- Inventory SKU label printing
- Ready-for-Pickup barcode lookup

Training labels are visibly marked **TRAINING** and should be discarded after practice.

## Portal label templates

Portal currently supports these print-layout identifiers:

- `30252` — 3.5 × 1.125 in
- `30336` — 2.125 × 1 in
- `30334` — 2.25 × 1.25 in
- `1760756` — 4 × 2.25 in layout support in the Portal 1.0 printer engine

Do not assume the selected template matches the physical roll. Verify the printer-recognized stock during commissioning.

## 550 Turbo commissioning checklist

Do this before calling the label path production-ready:

1. Install DYMO Connect for Desktop and the current printer driver.
2. Connect the 550 Turbo by USB or wired LAN.
3. Confirm every intended shop workstation can see the same printer.
4. Load the production DYMO label stock and confirm the printer recognizes it.
5. Select the matching Portal label template.
6. Print a Portal test SKU label.
7. Scan the SKU barcode into a training work order and confirm the exact inventory item resolves.
8. Print a Training Store work-order label.
9. Scan that work-order barcode from Ready for Pickup and confirm the correct fake ticket opens.
10. Create a Training Store PO, receive multiple units, and confirm the requested number of SKU labels prints.
11. Verify text, barcode quiet space, margins, orientation, and scanner readability.
12. Repeat one production-safe test before enabling the printer for normal staff use.

## Browser notes

Portal uses the operating system/browser print dialog. Depending on the workstation and browser, the selected DYMO printer and print settings may be remembered between jobs. Staff should still verify printer, stock size, orientation, scale, and margins whenever the print dialog does not retain them correctly.
