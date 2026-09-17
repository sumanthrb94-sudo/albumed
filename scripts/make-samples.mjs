/* Generates the sample photo set with Gemini. Run with the key in .env:
     node --env-file=.env scripts/make-samples.mjs
   Writes JPEGs into public/samples/. These are generated images — no real
   family is in them — and they exist so the demo and the quality comparison
   run on real photographic detail rather than drawn shapes. */
import { GoogleGenAI } from '@google/genai'
import { writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const OUT = resolve(new URL('../public/samples', import.meta.url).pathname)
const MODEL = process.env.ALBUMED_IMAGE_MODEL ?? 'gemini-3.1-flash-image'
const LOOK =
  'Documentary wedding photography, candid photojournalism, natural available light, ' +
  'real skin texture and fabric detail, shallow depth of field, 35mm or 50mm lens, ' +
  'no text, no watermark, no logo.'

const SCENES = [
  {
    file: '04-snathakam.jpg',
    prompt:
      'A young Indian groom in a white silk dhoti with a gold border and a sacred thread, seated cross-legged for the Telugu snathakam ceremony, a palm-leaf umbrella and walking stick beside him, elders watching. South Indian wedding hall, morning light.',
  },
  {
    file: '05-kashi-yatra.jpg',
    prompt:
      "A Telugu kashi yatra moment: the groom walking away with an umbrella and stick, the bride's brother laughing and holding him back by the arm, family crowding around amused. Outdoors at a kalyana mandapam, bright daylight.",
  },
  {
    file: '06-kanyadanam.jpg',
    prompt:
      "Kanyadanam at a Telugu wedding: the bride's father placing her hands into the groom's, his own hands weathered and steady, the mother pouring water over them. Close, tender, emotional. Red and gold silk, brass vessel, mandapam.",
  },
  {
    file: '07-appaginthalu.jpg',
    prompt:
      'Appaginthalu, the farewell at a Telugu wedding: the bride embracing her mother and weeping, relatives around them with hands on her shoulders, the groom waiting at the edge of the frame. Emotional, restrained, late afternoon light.',
  },
  {
    file: '08-family-portrait.jpg',
    prompt:
      'A formal Indian family group portrait at a Telugu wedding: three generations, about twelve people, grandparents seated in front, bride and groom at the centre in red and white silk, everyone looking at the camera with natural expressions. Kalyana mandapam with marigold decorations, even warm light.',
  },
  {
    file: '09-mandapam.jpg',
    prompt:
      'Detail photograph of an empty South Indian wedding mandapam before the ceremony: banana stems tied at the pillars, thick marigold and mango-leaf garlands, brass lamps lit, a rangoli muggu on the floor in rice flour. No people. Soft morning light.',
  },
  {
    file: '10-reception.jpg',
    prompt:
      'An Indian wedding reception: the couple on a decorated stage greeting guests, the bride in a deep green and gold silk saree, the groom in a cream sherwani, warm stage lighting and bokeh from fairy lights, guests queuing with gifts. Evening, indoor banquet hall.',
  },
]

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
if (!process.env.GEMINI_API_KEY) {
  console.error('Set GEMINI_API_KEY (node --env-file=.env scripts/make-samples.mjs)')
  process.exit(1)
}

let made = 0
for (const scene of SCENES) {
  const path = join(OUT, scene.file)
  if (existsSync(path)) {
    console.log(`  skip ${scene.file} (already there)`)
    continue
  }
  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: `${scene.prompt} ${LOOK}`,
      config: { responseModalities: ['IMAGE'] },
    })
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
    if (!part?.inlineData?.data) {
      console.log(`  ✗ ${scene.file}: no image came back`)
      continue
    }
    await writeFile(path, Buffer.from(part.inlineData.data, 'base64'))
    made++
    console.log(`  ✓ ${scene.file}`)
  } catch (err) {
    console.log(`  ✗ ${scene.file}: ${String(err.message ?? err).slice(0, 160)}`)
  }
}
console.log(`\n${made} new sample photos in public/samples/`)
