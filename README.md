# Albumed

**An AI album editor for Indian weddings.** Upload the raw take from a phone, and the assistant
looks at every frame: it knows a *muhurtham* from an *oonjal*, culls the soft and blinked shots,
writes captions in Tamil, Telugu, Kannada, Malayalam or Hindi, lays the album out in chapters that
follow the real order of the day — and then you keep editing it by just saying what you want.

> *"Make it look like a Kerala wedding album."*
> *"Give the thaali moment a full page of its own."*
> *"Put the reception chapter at the end and drop anything blurry."*

Each of those re-edits the actual album and re-flows the pages. Every change is undoable, and the
result exports as a print-ready PDF.

The photos never leave the device. The only thing that goes to the API is a small thumbnail of each
photo during the review pass; everything else — layout, rendering, export — happens in the browser.

---

## Quick start

```bash
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY to switch the assistant on
npm run build
npm start                     # http://localhost:8787
```

For development, `npm run dev` runs Vite and the API server together with hot reload on both.

**Without an API key the app still works end to end** — uploading, reviewing, all sixteen
templates, layout and PDF export. Only the assistant is switched off, and the UI says so.

### See the whole thing run

```bash
npm run build && npm run demo
```

This drives the real product in a real browser against a mock Claude upstream, so it works with no
API key and no network: create → upload → **AI review** → **AI plan** → **three AI edits** →
**undo** → PDF export → reload. It asserts as it goes (every photo tagged, chapters produced, the
template actually changed, the PDF page count matching the preview, the album surviving a reload)
and writes screenshots, `album.pdf` and `summary.json` to `demo-output/`.

To run the same demo against the real API: `ALBUMED_REAL_AI=1 ANTHROPIC_API_KEY=sk-ant-... npm run demo`.

---

## What the assistant does

### 1 · Reviews every photo (vision)

One pass over the thumbnails returns, per photo: which ceremony it belongs to, a 0–100 print score,
a keep-or-drop call, any visible technical problem, a caption in English and in the family's
language, one line explaining the decision, **and the focal point of the subject** — which the
layout engine then crops around, so a 3:2 frame in a square slot no longer cuts through someone's
face.

It knows the running order of a South Indian wedding: nischayathartham, pandhakaal, kashi yatra,
maalai maatral, oonjal, kanyadanam, muhurtham, saptapadi, nalangu, reception, grihapravesham —
alongside mehendi, haldi and sangeet for North Indian weddings, and the non-wedding occasions.

Nothing it decides is binding. Every verdict lands in the normal review screen as a suggestion you
can flip, and "Show what it said" lists its reasoning photo by photo.

### 2 · Plans the album

From the kept photos it picks the template, the cover, the title, and groups everything into
chapters in the order the day actually happened — each with a title in English and in the regional
script, and a line printed under it. Chapters become divider pages in the album.

### 3 · Edits the album from plain instructions

The chat on the album screen turns a request into a small set of validated operations —
`set_theme`, `feature_photos`, `drop_photos`, `reorder_chapters`, `set_captions`, `set_language`,
`regenerate` and a few more. The model proposes; **the client validates every id against what
actually exists** before anything is applied, reports what changed, says what it refused, and keeps
an undo stack.

That validation layer is the point: a hallucinated photo id or an invented template name is
rejected rather than applied, so the worst case of a bad model response is "nothing happened".

---

## The South Indian templates

| Template | Occasion | Look |
| --- | --- | --- |
| **Kanjeevaram Muhurtham** | Tamil wedding | Kanjeevaram maroon, temple gold, kolam corners, arched frames |
| **Pattu & Jasmine** | Telugu wedding | Jasmine white, leaf green and gold |
| **Kerala Kasavu** | Malayali wedding | Off-white kasavu cloth with a woven gold border and pookalam corners |
| **Mysore Silk** | Kannada wedding | Royal purple and gold mandalas |
| **Stage Reception** | Reception | Charcoal and gold, wide frames, no fuss |
| **Dakshin Kalyanam** | South Indian wedding | Emerald and gold with kolam |

Plus ten more for North Indian weddings (Royal Vivah, Marigold Mandap), the pre-wedding days
(Haldi Sunshine, Mehendi Night, Sangeet Midnight), engagements and receptions (Sagai Rose, Ivory
Minimal), and the rest of family life (Naamkaran Pastel, Birthday Confetti, Griha Pravesh,
Diwali Diya).

Every template is a palette, a type pairing, a frame shape (temple arch, rounded, circle) and a
motif painted on canvas around each page — mandala corners, paisley vines, a marigold toran,
rangoli and kolam corners, diyas, pookalam, a kasavu weave. Nothing is a bitmap, so it stays sharp
at 300 dpi.

Captions and chapter titles print in **Tamil, Telugu, Kannada, Malayalam, Hindi or English**, in
their own script, using self-hosted Noto Serif faces.

---

## The rest of the flow

**Add photos** — gallery picker, camera capture, or drag-and-drop of the folder a photographer
shared. Each upload is tagged Photographer or Customer. EXIF rotation from phones is baked in on
import; originals are capped at 3000px with a 640px thumbnail alongside.

**Review & finalize** — keep, drop, star, caption, and leave a note for the photographer. Filter by
status, star, uploader, or what the assistant said. Nothing is generated until you confirm the
selection — that is the gate, whether you curate by hand or let the assistant do it.

**Album** — every page rendered exactly as it prints, per-page layout re-shuffle and reorder, PDF
export at 150 / 200 / 300 dpi, single pages as JPG, and the native share sheet on a phone.

**Handover** — a project moves between photographer and customer as an `*.albumed.json` file: a
thumbnails-only copy small enough to send over chat, and a *merge decisions back in* import that
applies the customer's approvals to your full-resolution copy.

---

## How it fits together

```
src/
  lib/
    aiContract.ts   Zod schemas shared by browser and server — the AI's output contract
    ai.ts           browser client for /api/ai/*  (batching, thumbnail encoding)
    applyOps.ts     validates and applies the assistant's edits  (pure, unit-tested)
    layout.ts       19 page templates + the chapter-aware album generator
    render.ts       the canvas painter shared by the preview and the PDF
    motifs.ts       mandala, paisley, marigold, rangoli, kolam, diya, pookalam, kasavu
    themes.ts       the 16 templates, page sizes, per-language script fonts
    db.ts           IndexedDB: projects, photo metadata, blobs, albums
    images.ts       decode + EXIF rotation, thumbnails, bitmap cache, sample photos
    pdf.ts          PDF / JPG export, share sheet
    bundle.ts       project file export, import, decision merge
  components/       PageCanvas, ThemeGallery, Assistant, AlbumChat, ErrorBoundary
  screens/          Home, Upload, Review, Design, AlbumView
  store.tsx         app state and the three AI passes
server/
  handlers.ts       the API itself — health, the three AI routes, rate limiting
  index.ts          standalone Node server (Docker, self-hosting) + static client
  claude.ts         every Claude call — structured outputs, error translation
  prompts.ts        the system prompts
api/                the same handlers as Vercel serverless functions
tests/
  applyOps.test.ts  the edit applier, including malformed model output
  layout.test.ts    template geometry, chapters, featured pages, determinism
  api.test.ts       the server end to end against a mock upstream
  vercel.test.ts    the serverless adapters, invoked the way the platform does
  mock-anthropic.mjs
scripts/
  demo-e2e.mjs      the browser demo driver
  fetch-fonts.mjs   re-downloads the self-hosted fonts
  make-icons.mjs    generates the app icons (no image dependencies)
```

**The preview and the PDF call the same painter** — only the pixel size differs — so the preview is
genuinely what prints.

**Layout** chunks the photos into pages using a rhythm set by the chosen density, scores every
template of that size against the photos' orientations and the page aspect, penalises repeating the
previous page, and gives starred photos the hero slot. A seeded PRNG drives it, so *Re-shuffle*
gives a different album and the same seed always reproduces the same one.

---

## Deploying

The API is written once, in `server/handlers.ts`, and served two ways.

### Vercel

```bash
npx vercel            # preview
npx vercel --prod     # production
```

Set `ANTHROPIC_API_KEY` in **Project → Settings → Environment Variables** (any other variable from
`.env.example` works there too). `vercel.json` already wires up the build, the SPA rewrite, the CSP
and cache headers, and gives each AI function a 60-second budget — a vision pass over a batch of
photos does not fit in the 10-second default. `npx vercel dev` runs the functions and the client
together locally.

Two things to know about the serverless shape: the rate limiter is per instance, so put a real one
(KV, Upstash, the platform's) in front if you need a hard quota; and Vercel caps request bodies at
4.5 MB, which is why the review pass batches photos (`ALBUMED_CURATE_BATCH`, six by default — about
400 KB a request).

### Docker, or any Node host

```bash
docker build -t albumed .
docker run -p 8787:8787 -e ANTHROPIC_API_KEY=sk-ant-... albumed
```

Or `npm run build && npm start` on any Node 20+ box. The standalone server serves the built client
as well as the API: it keeps the key server-side, rate-limits per client per route, caps request
bodies, sends a strict CSP and the usual security headers, logs one JSON line per request, and
shuts down cleanly on SIGTERM. `/api/health` reports whether the assistant is configured and is
wired to the container health check.

Configuration is all environment variables — see `.env.example`.

### Cost

The review pass sends one 512px thumbnail per photo, batched (six per request by default, via
`ALBUMED_CURATE_BATCH`). Planning and editing are text-only. A 200-photo shoot is roughly 34 review
requests; the system prompt is cached across them. Lower `ALBUMED_MODEL` to `claude-sonnet-5` if you
want to trade some judgement for cost.

---

## Tests

```bash
npm test     # 39 unit + integration tests, no API key needed
npm run demo # the full browser demo, also no API key needed
```

`tests/mock-anthropic.mjs` stands in for `api.anthropic.com` and derives its replies from the
request, so ids are real and the assertions mean something. The server still builds every request
with the Anthropic SDK and validates every reply against the same Zod schemas the browser uses.

---

## Limits worth knowing

- **Storage is the device.** Clearing site data deletes the albums. Export a project file for
  anything you want to keep. Browsers cap site storage at a few GB, which is why imports are
  resized to 3000px.
- **HEIC** from iPhones decodes only where the browser supports it (Safari, recent Chrome on
  Android). Elsewhere, ask for JPEGs.
- **The assistant is a first draft, not an authority.** It has been given the vocabulary of a South
  Indian wedding, but it is guessing at which ceremony a photo belongs to from the photo alone.
  Check its chapter names before you print — especially for regional customs it may not have seen.
- **Pages, not spreads.** Print shops that want double-page spreads can impose the PDF, or use the
  12″ square lay-flat size.
- **The sample photos are generated procedurally** so the whole flow can be demonstrated without
  uploading anything real. They are coloured shapes, not photographs — the assistant's verdicts on
  them in the offline demo come from the mock, not from Claude.
