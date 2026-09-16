# Albumed — Indian album builder

Turn the raw photos on a phone into a print-ready Indian wedding or celebration album.

Upload the shots you took yourself or the ones the photographer sent → review them together and
finalize the keepers → pick an occasion template → the app lays out the album and exports a
print-ready PDF.

This is the **web version of the app** (an installable PWA). It runs entirely in the browser:
photos never leave the device, and it works offline once loaded. See
[Packaging as an APK](#packaging-as-an-apk) for turning it into an Android build.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run demo` | **End-to-end demo in a real browser** — see below |
| `npm run icons` | Regenerate the app icons |
| `npm run typecheck` | Type-check only |

### See it work end to end

Two ways:

1. **In the app** — open it and press **▶ Run the demo album** on the home screen. It creates a
   project, generates 12 sample photos, approves them, finalizes the selection and drops you on a
   laid-out album you can export.
2. **Headless** — `npm run build && npm run demo` drives the whole flow in Chromium
   (create → upload → review → finalize → switch template → preview → export PDF → reload) and
   writes screenshots, `album.pdf` and `summary.json` to `demo-output/`. It fails loudly if the
   PDF page count does not match the preview or if the album does not survive a reload.

---

## The flow

**1 · Add photos.** Gallery picker, camera capture, or drag-and-drop of the folder a photographer
shared. Each upload is tagged **Photographer** or **Customer** so you can tell later who added
what. EXIF rotation from phones is baked in on import, and oversized shots are resized to 3000px
on the long edge with a 640px thumbnail alongside.

**2 · Review & finalize.** Every photo starts as *to review*. Keep it (✓), leave it out (✕), or
star it as a highlight — stars get the biggest slot on a page, and the first star becomes the
cover. Tap any photo for the full-size view with captions, notes for the photographer, and
keyboard shortcuts (`A` approve, `R` reject, `←/→` navigate). Filter by status, by star, or by who
uploaded it, and apply a decision to everything currently shown.

Nothing is generated until you press **Confirm N photos & generate album** — that is the gate the
album generation waits on. You can reopen the selection at any time.

**3 · Album template.** Twelve occasion styles, each shown as a live-rendered cover:

| Occasion | Templates |
| --- | --- |
| Wedding | Royal Vivah · Marigold Mandap · Dakshin Kalyanam |
| Haldi / Mehendi / Sangeet | Haldi Sunshine · Mehendi Night · Sangeet Midnight |
| Engagement / Reception | Sagai Rose · Ivory Minimal |
| Baby, birthday, home, festival | Naamkaran Pastel · Birthday Confetti · Griha Pravesh · Diwali Diya |

Each template is a palette, a typeface pairing, a frame shape (temple arch, rounded, circle) and a
motif painted around every page — mandala corners, paisley vines, a marigold toran, rangoli and
kolam corners, diyas, confetti or pearls. Page size (8″ or 12″ square, A4 either way, 10×8, or a
9:16 phone story), photo density, cover, closing page, captions and page numbers are all options.

**4 · Album.** Every page rendered exactly as it will print, with per-page layout re-shuffle and
reordering. Export the whole thing as a PDF at 150 / 200 / 300 dpi, or save a single page as a JPG.
On a phone the export goes through the native share sheet.

---

## Handing the album between photographer and customer

Everything lives on the device, so a project moves as a file (`*.albumed.json`):

- **Send light copy for review** — thumbnails only, small enough to send over chat. The customer
  imports it, approves photos on their own phone, and exports it back.
- **Merge decisions back in** — reads a returned file and applies its approve/reject/star/caption
  decisions to your full-resolution copy, matching photos by name and size.
- **Export full project** — everything at full resolution, for moving to another device or backup.

---

## How the album is generated

`src/lib/layout.ts` walks the approved photos in order and chunks them into pages using a rhythm
that depends on the chosen density (airy `1–3`, balanced `1–4`, story `3–6`). For each chunk it
scores every template of that size against the photos' orientations and the page's aspect ratio,
penalises repeating the previous page's template, and picks the winner. Photos are then assigned to
slots largest-first, so a starred photo lands in the hero slot and portraits fall into upright
frames. A seeded PRNG drives the randomness, so **Re-shuffle layout** gives a different album and
the same seed always reproduces the same one.

`src/lib/render.ts` paints a page onto a canvas. The preview and the PDF call the exact same
painter — only the pixel size differs — so the preview is genuinely what you get.

---

## Where things live

```
src/
  lib/
    types.ts      data model
    db.ts         IndexedDB (projects, photo metadata, blobs, albums)
    images.ts     decode + EXIF rotation, thumbnails, bitmap cache, sample photos
    themes.ts     the 12 occasion templates and the page sizes
    layout.ts     page templates + the album generator
    motifs.ts     canvas painters for mandala, paisley, marigold, rangoli, kolam, diya…
    render.ts     the page painter shared by preview and export
    pdf.ts        PDF / JPG export, share sheet
    bundle.ts     project file export, import, decision merge
  components/     PhotoThumb, PageCanvas, ThemeGallery
  screens/        Home, Upload, Review, Design, AlbumView
  store.tsx       app state
scripts/
  demo-e2e.mjs    the end-to-end demo driver
  make-icons.mjs  generates the app icons
  fetch-fonts.mjs re-downloads the self-hosted fonts
```

### Storage

Photos, projects and generated albums are kept in **IndexedDB** on the device — originals and
thumbnails as blobs. Nothing is uploaded anywhere; there is no server and no account. That also
means clearing site data deletes the albums, so export a project file for anything you want to
keep. Browsers cap how much a site may store (usually a few GB); a very large shoot can hit that
limit, which is another reason imports are resized to 3000px.

---

## Packaging as an APK

The app is already a PWA — on Android, Chrome's **Install app** prompt puts it on the home screen
with its own icon and no browser chrome. For a real `.apk`/`.aab` on the Play Store, wrap this
build:

```bash
# Option A — Trusted Web Activity (thin wrapper around the hosted PWA)
npx @bubblewrap/cli init --manifest https://your-host/manifest.webmanifest
npx @bubblewrap/cli build

# Option B — Capacitor (bundles dist/ into the app, no hosting needed)
npm install @capacitor/core @capacitor/android
npx cap init Albumed app.albumed --web-dir=dist
npx cap add android && npm run build && npx cap sync && npx cap open android
```

Capacitor is the better fit here since everything is offline already; add
`@capacitor/camera` and `@capacitor/filesystem` if you want native camera and save-to-gallery
instead of the web file input and share sheet.

---

## Notes and limits

- Fonts (Cormorant Garamond, Marcellus, Mukta, Tiro Devanagari Hindi — all SIL OFL) are
  self-hosted in `public/fonts` so pages render identically offline. Re-fetch with
  `node scripts/fetch-fonts.mjs`.
- HEIC from iPhones decodes only where the browser supports it; Safari and recent Chrome on
  Android do. Elsewhere, ask for JPEGs.
- The album is page-by-page, not double-page spreads. Print shops that want spreads can impose the
  PDF, or pick the 12″ square lay-flat size.
- The sample photos are generated procedurally — they exist so the whole flow can be demonstrated
  without uploading anything real.
