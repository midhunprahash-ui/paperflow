# Sidebar interaction verification

The sidebar keeps a fixed internal layout while its outside width changes.
Logo, toggle, navigation icon and account avatar retain their coordinates. Labels
fade without changing row heights or wrapping during the transition. Collapsed
links and buttons retain small hit areas, preventing focus from scrolling the
sidebar horizontally. Crossing the mobile breakpoint does not animate the main
content's margin.

Run `npm run test:sidebar` with `npm run dev:docling` serving localhost:3001.
This test creates a disposable Supabase account using ignored `.env.local`, then
signs it out and removes it in a guarded cleanup block. It does not alter existing
accounts or papers. Results and screenshots are written to ignored
`tmp/sidebar-verification/`.

Verified on 2026-09-06:

- 306 sampled frames during 12 normal toggles and 20 rapid reversals.
- Zero measured icon movement and zero gap between sidebar and content.
- Expanded/collapsed checks at 1440, 1024, 768 and 641 pixels wide.
- Profile footer remained 18 pixels from the viewport bottom in both states.
- Nine mobile menu cycles across 640, 390 and 320 pixel widths.
- Profile popover, Escape dismissal, focus restoration, resize handling,
  reduced motion, short-window behavior and actual logout passed.
- No browser page errors or horizontal overflow in the tested cases.

The existing six desktop/mobile end-to-end tests and 31 unit tests also passed.
These results cover the listed Chromium scenarios, not every browser or device.
