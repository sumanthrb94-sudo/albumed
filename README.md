# Albumed

**Live demo: https://albumed-sumanthrb94-3803s-projects.vercel.app**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/sumanthrb94-sudo/albumed&project-name=albumed&repository-name=albumed&env=ANTHROPIC_API_KEY&envDescription=Optional.%20Without%20it%20the%20assistant%20runs%20in%20demo%20mode%20with%20scripted%20replies.&envLink=https%3A%2F%2Fconsole.anthropic.com%2Fsettings%2Fkeys)

One click deploys your own copy. `GEMINI_API_KEY` is optional — leave it blank and the assistant
runs in demo mode with scripted replies, clearly labelled, so the deployment demos with no key at
all. Nothing else needs configuring; `vercel.json` is in the repo.

**An AI album editor for Indian weddings.** Built in Rajahmundry, on the Godavari — Telugu weddings
are home ground, and the templates and ceremony vocabulary reach across the country.

Upload the raw take from a phone, and the assistant looks at every frame: it knows a *jeelakarra
bellam* from a *maalai maatral*, culls the soft and blinked shots, writes captions in Telugu, Tamil,
Kannada, Malayalam, Hindi, Bengali, Marathi, Gujarati or Punjabi, lays the album out in chapters
that follow the real order of the day — and then you keep editing it by just saying what you want.

> *"Make it look like a Kerala wedding album."*
> *"Give the thaali moment a full page of its own."*
> *"Put the reception chapter at the end and drop anything blurry."*

Each of those re-edits the actual album and re-flows the pages. Every change is undoable, and the
result exports as a print-ready PDF.

The photos never leave the device. The only thing that goes to the API is a small thumbnail of each
photo during the review pass; everything else — layout, rendering, export — happens in the browser.

**How it pays for itself: free albums store a compressed copy of every photo.** You get the whole
product — every template, the assistant, the full layout, a watermarked draft PDF — and the album on
screen looks right. What you do not get is the photograph. Subscribe and the same album prints at
the quality it was shot at. The app does not argue this point; it shows you, side by side, what the
compression took (see *Plans* below).

---

## Quick start

```bash
npm install
cp .env.example .env          # add GEMINI_API_KEY to switch the assistant on
npm run build
npm start                     # http://localhost:8787
```

For development, `npm run dev` runs Vite and the API server together with hot reload on both.

**Without an API key the app still works end to end.** Uploading, reviewing, all 23 templates,
layout and PDF export run regardless. The assistant falls back to **demo mode**: scripted replies,
shaped exactly like the real ones and derived from your actual photos, so a presentation works with
no key, no network and no cost. It is labelled everywhere it appears — a badge in the assistant
panel and the chat, a chip in the header, and `demo: true` on `/api/health` — because scripted
output must never be able to pass as live AI. `ALBUMED_DEMO_AI=0` switches the assistant off
outright instead; a real key always takes precedence.

Demo mode follows a fixed set of requests (a region or mood, a language, featuring a photo, dropping
weak frames, reordering chapters, density). Ask it something outside that and it says so rather than
pretending.

### See the whole thing run

```bash
npm run build && npm run demo
```

This drives the real product in a real browser against a mock Claude upstream, so it works with no
API key and no network. Entry to exit: **sign in with a phone number and a one-time code** → create
on the free plan → upload → **see the compression comparison** → **AI review** → **AI plan** →
**three AI edits** → **undo** → **free watermarked draft** → hit the paywall → **subscribe** →
**re-import originals** → 300 dpi export → reload → **sign out and sign back in**.

It asserts as it goes: a half-typed number is refused, a wrong code is refused and counted, the
right one gets in, every photo tagged, chapters produced, the template actually changed, press
resolutions locked on free and unlocked after subscribing, the originals replacing the compressed
copies, the paid PDF carrying at least 1.5× the data of the free draft, the page count matching the
preview, the album and the session both surviving a reload, and the albums still there after a sign
out and sign back in. Screenshots, both PDFs and `summary.json` land in `demo-output/`.

Run the same script against the shipped demo mode with `ALBUMED_DEMO_AI=1 npm run demo` — no mock
upstream at all, exactly what a deployment with no key serves — or against the real API with
`ALBUMED_REAL_AI=1 ANTHROPIC_API_KEY=sk-ant-... npm run demo`. All three pass.

---

## What the assistant does

### 1 · Reviews every photo (vision)

One pass over the thumbnails returns, per photo: which ceremony it belongs to, a 0–100 print score,
a keep-or-drop call, any visible technical problem, a caption in English and in the family's
language, one line explaining the decision, **and the focal point of the subject** — which the
layout engine then crops around, so a 3:2 frame in a square slot no longer cuts through someone's
face.

It knows the running order of a Telugu wedding — nischitartham, pellikuthuru, snathakam, kashi
yatra, madhuparkam, jeelakarra bellam, mangalsutra dharana, talambralu, kanyadanam, saptapadi,
appaginthalu — and the equivalents elsewhere: maalai maatral and oonjal in Tamil Nadu, antarpat in
Maharashtra, subho drishti and sindoor daan in Bengal, hastamelap in Gujarat, anand karaj in Punjab,
the baraat and pheras in the north. Forty ceremonies in all, plus receptions, housewarmings, naming
days and birthdays. It is told to read the photos in front of it rather than assume — a Bengali
wedding does not get Telugu chapter names.

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

## Plans

| | Free | Plus — ₹249/month | Studio — ₹5,999/year |
| --- | --- | --- | --- |
| Photos stored at | 1280px, heavily compressed | 4000px, print grade | 6000px, print grade |
| Export | 150 dpi, watermarked | 300 dpi, clean | 600 dpi, clean |
| Photos per album | 60 | 600 | 3000 |
| Assistant reviews | first 24 photos | every photo | every photo |
| Templates, layout, chapters, AI editing | all of it | all of it | all of it |

Everything except the photograph itself is free. That is deliberate: someone should be able to build
the album, see the assistant sort their pellikuthuru from their reception, watch the pages lay
themselves out, and only then decide whether it is worth paying to print properly.

Two things keep it honest:

- **You can see what you are losing.** On import, a free album keeps one extra thing: a 560px crop
  of the photo *at its original resolution*, next to the same crop as it survives in the stored copy.
  The comparison slider puts them one over the other at the same size. Zari thread, embroidery and
  jewellery are where the difference shows.
- **Upgrading is not too late.** The originals were never deleted — they are still in the phone's
  gallery. Subscribe, pick the same files again, and they replace the compressed copies in place.
  The album, its chapters, the captions and every edit stay exactly as they were.

Pricing is indicative while this is being designed, and payments are not wired up: `checkoutFor()`
in `src/lib/plan.ts` builds the order a provider would be handed, and choosing a plan switches it on
locally so the difference can be seen. Every limit lives in that one file.

## Templates, region by region

| Region | Templates |
| --- | --- |
| **Andhra & Telangana** | Godavari Pellikuthuru, Kalyana Mandapam, Pattu & Jasmine, Tirupati Saffron, Seemantham |
| Tamil Nadu | Kanjeevaram Muhurtham, Chettinad Athangudi |
| Karnataka | Mysore Silk, Kodava Coffee |
| Kerala | Kerala Kasavu |
| South India | Dakshin Kalyanam, Upanayanam, Shashtiabdapoorthi |
| Bengal | Lal Paar |
| Odisha | Sambalpuri Ikat |
| North East | Assam Muga |
| Bihar & Jharkhand | Mithila Madhubani |
| Maharashtra | Paithani Peacock |
| Punjab | Phulkari |
| Gujarat & Rajasthan | Bandhani, Rajputana Blue |
| North India | Royal Vivah, Marigold Mandap, Awadhi Chikankari |
| Pan-India | Editorial Mono, Haldi Sunshine, Mehendi Night, Sangeet Midnight, Sagai Rose, Ivory Minimal, Stage Reception, Naamkaran Pastel, Birthday Confetti, Griha Pravesh, Diwali Diya |

Thirty-five in all — `npm run templates` renders every cover into one contact sheet. Every one is a palette, a type pairing, a frame shape (temple arch, rounded,
circle) and a motif painted on canvas around each page — muggu and kolam corners, mandalas, paisley
vines, a marigold toran, rangoli, diyas, pookalam, a kasavu weave, Bengali alpona, a Paithani
peacock, phulkari stitching, bandhani dots. Nothing is a bitmap, so it stays sharp at 600 dpi.

Every template is a palette, a type pairing, a frame shape (temple arch, rounded, circle) and a
motif painted on canvas around each page — mandala corners, paisley vines, a marigold toran,
rangoli and kolam corners, diyas, pookalam, a kasavu weave. Nothing is a bitmap, so it stays sharp
at 300 dpi.

Captions and chapter titles print in **Telugu, Tamil, Kannada, Malayalam, Hindi, Bengali, Marathi,
Gujarati, Punjabi or English**, in their own script, using self-hosted Noto Serif faces.

---

## The rest of the flow

**Sign in** — an Indian mobile number and a six digit code. **There is no backend behind this**: the
code is generated in the browser and printed on the sign-in card, under a banner that says so. What
it does carry is the real shape of the flow — number validation, a five minute expiry, a wrong-code
path, five attempts, a thirty second resend cooldown, and a session that survives a reload for
thirty days. Swapping in a real SMS provider means replacing `issueCode` and `verifyCode` in
`src/lib/auth.ts` with two server calls; nothing else in the app changes. Signing out clears the
session, not the albums — they belong to the device.

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
    auth.ts         phone + one-time code, simulated in the browser  (unit-tested)
    plan.ts         the plans and every limit the product enforces
    reimport.ts     matching re-picked originals to the photos already in an album
    aiContract.ts   Zod schemas shared by browser and server — the AI's output contract
    ai.ts           browser client for /api/ai/*  (batching, thumbnail encoding)
    applyOps.ts     validates and applies the assistant's edits  (pure, unit-tested)
    layout.ts       19 page templates + the chapter-aware album generator
    render.ts       the canvas painter shared by the preview and the PDF
    motifs.ts       mandala, paisley, marigold, rangoli, kolam, diya, pookalam, kasavu
    themes.ts       the 35 album templates, page sizes, per-language script fonts
    db.ts           IndexedDB: projects, photo metadata, blobs, albums
    images.ts       decode + EXIF rotation, thumbnails, bitmap cache, sample photos
    pdf.ts          PDF / JPG export, share sheet
    bundle.ts       project file export, import, decision merge
  components/       PageCanvas, ThemeGallery, Assistant, AlbumChat, Paywall,
                    QualityCompare, ErrorBoundary
  screens/          SignIn, Home, Upload, Review, Design, AlbumView
  store.tsx         app state and the three AI passes
server/
  handlers.ts       the API itself — health, the three AI routes, rate limiting
  index.ts          standalone Node server (Docker, self-hosting) + static client
  claude.ts         every Claude call — structured outputs, error translation
  prompts.ts        the system prompts
  demoAi.ts         scripted replies for demos without a key, always labelled
api/                the same handlers as Vercel serverless functions
tests/
  applyOps.test.ts  the edit applier, including malformed model output
  layout.test.ts    template geometry, chapters, featured pages, determinism
  auth.test.ts      the sign-in flow: expiry, attempt limit, cooldown, sessions
  plan.test.ts      plan limits never regress, and re-import matching
  build.test.ts     the deployed shape: absolute assets, CSP, api/ routes
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

Use the Deploy button at the top of this file, or from a clone:

```bash
npx vercel            # preview
npx vercel --prod     # production
```

Set `ANTHROPIC_API_KEY` in **Project → Settings → Environment Variables** (any other variable from
`.env.example` works there too). `vercel.json` already wires up the build, the SPA rewrite, the CSP
and cache headers, and gives each AI function a 60-second budget — a vision pass over a batch of
photos does not fit in the 10-second default. `npx vercel dev` runs the functions and the client
together locally.

Everything in `api/` is a route and nothing else; the adapter they share lives in
`server/vercel.ts`. The client build uses an absolute base so the SPA rewrite can serve
`index.html` from any path and the assets still resolve — `tests/build.test.ts` holds both of
those, along with the no-inline-script rule the CSP depends on.

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

### What it costs to run

Measured from real `gemini-3.8-flash` calls in September 2026, at $0.75/$3.75 per million input and
output tokens and ₹96.07 to the dollar. Thinking tokens bill as output and are included — they were
about 60% of output on the vision pass, which is worth knowing before tuning anything else.

| | Measured |
| --- | --- |
| Review, 6 photos (one batch) | ₹1.44 |
| Plan the album | ₹0.46 |
| One edit-chat message | ₹0.58 |
| **30-photo album**, reviewed + planned + 5 edits | **₹10.56** |
| **200-photo album** (a real wedding take) | **₹52.45** |
| **600-photo album** | **₹147.77** |

Against a ₹999 PDF download or a ₹15,300 printed album, **the assistant is not the cost of this
business** — it is well under 1% of revenue even on a 600-photo shoot. The limits in
`src/lib/plan.ts` exist to stop abuse, not to control model spend, and should be set with that in
mind.

**Image generation is the exception, by two orders of magnitude.** `gemini-3.1-flash-image` is
about ₹6.44 per 1K image, so generating an edited version of every photo in a 200-photo album would
cost ₹1,288 — more than the PDF sells for. Anything that generates images per customer photo has to
be priced as its own line item, not folded into a subscription.

Note the token rates are promotional until 31 December 2026 and double after that; these figures
double with them. `npm run samples` regenerates the sample set and cost ₹45 for seven images.

---

## Tests

```bash
npm test     # 68 unit + integration tests, no API key needed
npm run demo # the full browser demo, also no API key needed
```

`tests/mock-anthropic.mjs` stands in for `api.anthropic.com` and derives its replies from the
request, so ids are real and the assertions mean something. The server still builds every request
with the Anthropic SDK and validates every reply against the same Zod schemas the browser uses.

---

## Limits worth knowing

- **The sign-in is a simulation.** The one-time code is generated in the browser and shown on
  screen, which is not authentication — it demonstrates the flow. Anyone typing any valid Indian
  mobile number gets in, and the session only gates this device's own albums, which were never on a
  server to begin with. A real deployment needs an SMS provider and a server-side session.
- **Storage is the device.** Clearing site data deletes the albums. Export a project file for
  anything you want to keep. Browsers cap site storage at a few GB, which is the practical reason
  free albums are compressed as well as the commercial one.
- **HEIC** from iPhones decodes only where the browser supports it (Safari, recent Chrome on
  Android). Elsewhere, ask for JPEGs.
- **The assistant is a first draft, not an authority.** It has been given the vocabulary of a South
  Indian wedding, but it is guessing at which ceremony a photo belongs to from the photo alone.
  Check its chapter names before you print — especially for regional customs it may not have seen.
- **Pages, not spreads.** Print shops that want double-page spreads can impose the PDF, or use the
  12″ square lay-flat size.
- **The 25 sample photos are generated, not taken.** No real family is in them. They cover a Telugu
  wedding end to end — pellikuthuru through the reception — and are deliberately a *studio take*
  rather than a portfolio: two near-duplicate pairs of the same moment, and three frames that should
  be thrown away (motion-blurred, everyone mid-blink, a guest's phone across the lens). Without
  those, the culling pass has nothing to do and the demo flatters itself. `npm run samples`
  regenerates the set and writes `public/samples/index.json`, which the app reads at runtime — adding
  a photograph is a file drop, not a code change. A procedural fallback still draws stand-ins if the
  files are not deployed.
