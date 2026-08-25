# GotCracked work-order label printing

## Recommended hardware

Use a **DYMO LabelWriter 550** with authentic DYMO adhesive name-badge labels, item **1760756**, sized **2-1/4 × 4 inches**. The portal print layout is designed for this exact label size in landscape orientation.

The 550 connects by USB to one Windows or Mac workstation. Choose the **LabelWriter 550 Turbo** instead if multiple shop computers need to reach the printer over the local network. The wider 5XL is not needed for this label.

Install the current DYMO Connect for Desktop software and printer driver before using the portal print action.

## Printing a label

1. Open a repair ticket.
2. Select **Print device label**.
3. In the browser print dialog, choose the DYMO printer.
4. Choose the 4 × 2-1/4 inch label, landscape orientation, 100% scale, and no margins.
5. Print one label and attach it to the repair bag or intake container—not directly to a customer device.

The QR code contains only the portal work-order URL and ticket number. It does not place customer contact information in the barcode. The work order remains protected by portal authentication.

## Scanning

Scan the QR code with a phone or workstation scanner capable of reading QR codes. It opens `https://portal.gotcracked.co/?ticket=...`. If the employee is signed out, the portal preserves the ticket link and opens that work order after authentication.

## Browser notes

The first print uses the operating system's normal print dialog so the browser does not receive unrestricted printer access. The selected printer and label settings may be remembered by the workstation, depending on browser and operating-system settings.
