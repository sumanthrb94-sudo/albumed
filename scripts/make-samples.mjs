/* Generates the sample photo set with Gemini. Run with the key in .env:
     node --env-file=.env scripts/make-samples.mjs
   Writes JPEGs into public/samples/. These are generated images — no real
   family is in them — and they exist so the demo and the quality comparison
   run on real photographic detail rather than drawn shapes. */
import { GoogleGenAI } from '@google/genai'
import { writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
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
    file: '11-muhurtham-thaali.jpg',
    prompt:
      'The mangalsutra dharana at a Telugu wedding: the groom tying the thaali around the bride\'s neck, her head bowed, both sets of hands in frame, the priest\'s arm at the edge. The single most important frame of the day. Red and gold Kanjeevaram silk, mandapam, warm light.',
  },
  {
    file: '12-muhurtham-thaali-alt.jpg',
    prompt:
      'The same mangalsutra moment at a Telugu wedding a second later, seen slightly wider: groom tying the thaali, bride with eyes lowered, relatives visible behind holding rice, one hand raised mid-blessing. Nearly the same composition as the previous frame. Mandapam, warm light.',
  },
  {
    file: '13-talambralu-alt.jpg',
    prompt:
      'A second frame of the talambralu ritual, a moment after the first: the bride pouring rice over the groom while he shields his face and laughs, rice scattered on their shoulders. Same couple, same mandapam, very similar composition to the earlier talambralu photograph.',
  },
  {
    file: '14-mehendi-hands.jpg',
    prompt:
      "Close detail of an Indian bride's hands covered in intricate fresh dark mehendi, resting in her lap on red silk, gold and red bangles stacked at the wrists. Shallow depth of field, soft window light.",
  },
  {
    file: '15-pellikoduku.jpg',
    prompt:
      'Pellikoduku ceremony: a young Indian groom seated on a low wooden stool while male relatives and his mother apply turmeric paste to his arms and face, everyone laughing. Home courtyard, morning daylight.',
  },
  {
    file: '16-baraat.jpg',
    prompt:
      'A South Indian wedding procession at dusk: the groom garlanded and walking under a decorated umbrella, family dancing around him, a brass band with trumpets and drums, string lights overhead. Motion and energy, warm evening light.',
  },
  {
    file: '17-sannai-melam.jpg',
    prompt:
      'Two elderly South Indian musicians playing nadaswaram and thavil at a wedding, cheeks puffed, absorbed in the music, seated to one side of the mandapam. Documentary detail, warm light.',
  },
  {
    file: '18-elders-blessing.jpg',
    prompt:
      'An elderly Indian couple showering rice and blessing a newly married couple who are bowing to touch their feet. Emotional, restrained, mandapam with marigolds, warm afternoon light.',
  },
  {
    file: '19-couple-portrait.jpg',
    prompt:
      'A posed portrait of a South Indian bride and groom standing together after the ceremony, looking at the camera, she in red and gold Kanjeevaram silk and temple jewellery, he in a cream silk dhoti and angavastram. Clean background, soft directional light, full length.',
  },
  {
    file: '20-couple-candid.jpg',
    prompt:
      'A candid moment between a South Indian bride and groom: she is laughing with her head turned away, he is watching her rather than the camera. Unposed, natural, shallow depth of field, golden hour.',
  },
  {
    file: '21-jewellery-detail.jpg',
    prompt:
      "Detail of a South Indian bride being dressed: her mother's hands fastening a gold temple-jewellery necklace at the back of her neck, jasmine strand in her hair, red silk blouse. Close, soft window light.",
  },
  {
    file: '22-sadhya.jpg',
    prompt:
      'A South Indian wedding feast: rows of guests seated on the floor eating from banana leaves, servers walking the line with buckets, hands mid-motion. Documentary overhead-ish angle, bright hall.',
  },
  {
    file: '23-blurry-dance.jpg',
    prompt:
      'A badly blurred photograph from an Indian wedding reception in South India: guests in sarees and kurtas dancing, heavy motion blur across the whole frame so faces are smeared and unreadable, camera shake, dim indoor banquet hall with marigold decorations. An out-of-focus throwaway frame, clearly unusable.',
  },
  {
    file: '24-eyes-closed.jpg',
    prompt:
      'A group photograph at an Indian wedding that did not work: eight relatives posed together but three of them have their eyes shut mid-blink and one is looking away and talking. Otherwise well lit and sharp. The kind of frame a photographer discards.',
  },
  {
    file: '25-obstructed.jpg',
    prompt:
      "A spoiled wedding photograph: a guest's shoulder and raised phone have crossed directly in front of the camera, blocking most of the bride and groom at the mandapam. Only a sliver of the couple is visible. The kind of frame a photographer discards.",
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
/* A manifest, so the app discovers the set at runtime and adding a photo never
   means editing code. Labels come from the filename. */
const listed = readdirSync(OUT)
  .filter((f) => /^\d+-.*\.jpg$/.test(f))
  .sort()
  .map((file) => ({
    file,
    label: file
      .replace(/^\d+-/, '')
      .replace(/\.jpg$/, '')
      .split('-')
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' '),
  }))
await writeFile(join(OUT, 'index.json'), JSON.stringify(listed, null, 2) + '\n')
console.log(`\n${made} new sample photos; manifest lists ${listed.length} in public/samples/`)
