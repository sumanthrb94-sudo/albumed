import type { PageSizeSpec, SlotShape } from './types'

export type MotifKind = 'mandala' | 'paisley' | 'marigold' | 'rangoli' | 'diya' | 'kolam' | 'confetti' | 'pearl'

export interface Palette {
  /** Page background. */
  paper: string
  /** Secondary wash used for gradients / bands. */
  paperAlt: string
  ink: string
  inkSoft: string
  accent: string
  accentSoft: string
  gold: string
  /** Cover background. */
  cover: string
  coverAlt: string
  coverInk: string
}

export interface Theme {
  id: string
  name: string
  occasion: string
  /** One-line description shown in the picker. */
  blurb: string
  /** Script flourish printed on the cover, e.g. शुभ विवाह. */
  script: string
  defaultTitle: string
  closingLine: string
  closingScript: string
  palette: Palette
  motif: MotifKind
  /** Default photo frame shape for this theme. */
  shape: SlotShape
  titleFont: string
  bodyFont: string
  scriptFont: string
}

const SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif"
const DISPLAY = "'Marcellus', Georgia, serif"
const SANS = "'Mukta', 'Segoe UI', system-ui, sans-serif"
const DEVA = "'Tiro Devanagari Hindi', 'Noto Sans Devanagari', Georgia, serif"

export const THEMES: Theme[] = [
  {
    id: 'vivah-gold',
    name: 'Royal Vivah',
    occasion: 'Wedding',
    blurb: 'Deep maroon, gold mandalas and arched frames — the classic North Indian wedding album.',
    script: 'शुभ विवाह',
    defaultTitle: 'Our Wedding',
    closingLine: 'Thank you for blessing our beginning',
    closingScript: 'धन्यवाद',
    palette: {
      paper: '#fbf4e8',
      paperAlt: '#f4e6cf',
      ink: '#3a1116',
      inkSoft: '#8a5c4a',
      accent: '#7a1220',
      accentSoft: '#b8535c',
      gold: '#c8972f',
      cover: '#6d0f1c',
      coverAlt: '#3d060f',
      coverInk: '#f6e3bb',
    },
    motif: 'mandala',
    shape: 'arch',
    titleFont: DISPLAY,
    bodyFont: SERIF,
    scriptFont: DEVA,
  },
  {
    id: 'marigold-mandap',
    name: 'Marigold Mandap',
    occasion: 'Wedding',
    blurb: 'Genda-phool orange and temple red with garland borders. Warm and festive.',
    script: 'विवाह',
    defaultTitle: 'The Wedding',
    closingLine: 'With love and gratitude',
    closingScript: 'आभार',
    palette: {
      paper: '#fff6e6',
      paperAlt: '#ffe9c4',
      ink: '#52220b',
      inkSoft: '#9a6231',
      accent: '#d35400',
      accentSoft: '#f08a3c',
      gold: '#cf9b23',
      cover: '#c0390d',
      coverAlt: '#7c1f07',
      coverInk: '#ffeec9',
    },
    motif: 'marigold',
    shape: 'round',
    titleFont: DISPLAY,
    bodyFont: SERIF,
    scriptFont: DEVA,
  },
  {
    id: 'dakshin-temple',
    name: 'Dakshin Kalyanam',
    occasion: 'Wedding',
    blurb: 'Kanjeevaram gold-on-emerald with kolam corners — South Indian wedding styling.',
    script: 'कल्याणम्',
    defaultTitle: 'Our Kalyanam',
    closingLine: 'Blessed by family and friends',
    closingScript: 'नन्द्रि',
    palette: {
      paper: '#f6f7ef',
      paperAlt: '#e6efdf',
      ink: '#14301f',
      inkSoft: '#4c6b52',
      accent: '#0f5132',
      accentSoft: '#3f8f66',
      gold: '#b8912c',
      cover: '#0d4029',
      coverAlt: '#06251a',
      coverInk: '#f0e2b4',
    },
    motif: 'kolam',
    shape: 'arch',
    titleFont: DISPLAY,
    bodyFont: SERIF,
    scriptFont: DEVA,
  },
  {
    id: 'haldi-sun',
    name: 'Haldi Sunshine',
    occasion: 'Haldi',
    blurb: 'Turmeric yellow, bright and playful — perfect for haldi and pithi mornings.',
    script: 'हल्दी',
    defaultTitle: 'Haldi Ceremony',
    closingLine: 'A morning full of sunshine',
    closingScript: 'शुभम्',
    palette: {
      paper: '#fffbe9',
      paperAlt: '#fff2c0',
      ink: '#4a3505',
      inkSoft: '#97772a',
      accent: '#e0a800',
      accentSoft: '#f6c944',
      gold: '#c79100',
      cover: '#f0b400',
      coverAlt: '#c98000',
      coverInk: '#4a3505',
    },
    motif: 'marigold',
    shape: 'round',
    titleFont: DISPLAY,
    bodyFont: SANS,
    scriptFont: DEVA,
  },
  {
    id: 'mehendi-green',
    name: 'Mehendi Night',
    occasion: 'Mehendi',
    blurb: 'Henna green with paisley vines curling around every frame.',
    script: 'मेहंदी',
    defaultTitle: 'Mehendi',
    closingLine: 'Stained hands, full hearts',
    closingScript: 'प्रेम',
    palette: {
      paper: '#f4f8ee',
      paperAlt: '#e3efd6',
      ink: '#1f3312',
      inkSoft: '#5b7546',
      accent: '#4f7a21',
      accentSoft: '#8bb35a',
      gold: '#a8892f',
      cover: '#2f5216',
      coverAlt: '#17300a',
      coverInk: '#eaf3d8',
    },
    motif: 'paisley',
    shape: 'round',
    titleFont: DISPLAY,
    bodyFont: SERIF,
    scriptFont: DEVA,
  },
  {
    id: 'sangeet-night',
    name: 'Sangeet Midnight',
    occasion: 'Sangeet',
    blurb: 'Indigo night with gold sparkle — dancing, dhol and stage lights.',
    script: 'संगीत',
    defaultTitle: 'Sangeet Night',
    closingLine: 'We danced till the lights came on',
    closingScript: 'नृत्य',
    palette: {
      paper: '#f2f3fb',
      paperAlt: '#e0e3f5',
      ink: '#1b1f3f',
      inkSoft: '#5a5f85',
      accent: '#2f3a8f',
      accentSoft: '#6c78cf',
      gold: '#c9a227',
      cover: '#1b1f4b',
      coverAlt: '#0b0d24',
      coverInk: '#f1e2ae',
    },
    motif: 'confetti',
    shape: 'rect',
    titleFont: DISPLAY,
    bodyFont: SANS,
    scriptFont: DEVA,
  },
  {
    id: 'sagai-rose',
    name: 'Sagai Rose',
    occasion: 'Engagement',
    blurb: 'Blush rose and ivory with pearl detailing — soft and romantic.',
    script: 'सगाई',
    defaultTitle: 'Our Engagement',
    closingLine: 'The beginning of forever',
    closingScript: 'स्नेह',
    palette: {
      paper: '#fff8f7',
      paperAlt: '#fbe8e6',
      ink: '#4b2330',
      inkSoft: '#9a6b78',
      accent: '#b8566e',
      accentSoft: '#e0949f',
      gold: '#c9a66b',
      cover: '#a8455e',
      coverAlt: '#6c2338',
      coverInk: '#fde9ea',
    },
    motif: 'pearl',
    shape: 'round',
    titleFont: DISPLAY,
    bodyFont: SERIF,
    scriptFont: DEVA,
  },
  {
    id: 'reception-ivory',
    name: 'Ivory Minimal',
    occasion: 'Reception',
    blurb: 'Clean ivory and charcoal with a single gold hairline. Lets the photos speak.',
    script: '',
    defaultTitle: 'Reception',
    closingLine: 'Thank you for celebrating with us',
    closingScript: '',
    palette: {
      paper: '#fcfaf6',
      paperAlt: '#f0ece3',
      ink: '#23211e',
      inkSoft: '#6e6a63',
      accent: '#3f3b35',
      accentSoft: '#8d867b',
      gold: '#b9a06a',
      cover: '#1f1d1a',
      coverAlt: '#111010',
      coverInk: '#f3ece0',
    },
    motif: 'pearl',
    shape: 'rect',
    titleFont: DISPLAY,
    bodyFont: SERIF,
    scriptFont: DEVA,
  },
  {
    id: 'naamkaran',
    name: 'Naamkaran Pastel',
    occasion: 'Baby / Naming',
    blurb: 'Soft pastels and tiny footprints — naamkaran, annaprashan and first birthdays.',
    script: 'नामकरण',
    defaultTitle: 'Naamkaran',
    closingLine: 'Our little blessing',
    closingScript: 'आशीर्वाद',
    palette: {
      paper: '#fdfaff',
      paperAlt: '#eef1fb',
      ink: '#2f3350',
      inkSoft: '#767b9c',
      accent: '#7b86d6',
      accentSoft: '#b3bbef',
      gold: '#c9b06b',
      cover: '#8e9ae0',
      coverAlt: '#5b67ac',
      coverInk: '#fdfbff',
    },
    motif: 'pearl',
    shape: 'circle',
    titleFont: DISPLAY,
    bodyFont: SANS,
    scriptFont: DEVA,
  },
  {
    id: 'birthday-confetti',
    name: 'Birthday Confetti',
    occasion: 'Birthday',
    blurb: 'Bright confetti bursts on cream — birthdays and anniversaries.',
    script: 'जन्मदिन',
    defaultTitle: 'Happy Birthday',
    closingLine: 'Here is to many more',
    closingScript: 'शुभकामनाएँ',
    palette: {
      paper: '#fffdf7',
      paperAlt: '#fdeee2',
      ink: '#3b2540',
      inkSoft: '#8a6d94',
      accent: '#e0417a',
      accentSoft: '#f78bab',
      gold: '#d8a92f',
      cover: '#d4326b',
      coverAlt: '#8d1c48',
      coverInk: '#fff3e2',
    },
    motif: 'confetti',
    shape: 'round',
    titleFont: DISPLAY,
    bodyFont: SANS,
    scriptFont: DEVA,
  },
  {
    id: 'griha-pravesh',
    name: 'Griha Pravesh',
    occasion: 'House warming',
    blurb: 'Terracotta and rangoli corners for griha pravesh and pooja days.',
    script: 'गृह प्रवेश',
    defaultTitle: 'Griha Pravesh',
    closingLine: 'May this home always be full',
    closingScript: 'शुभ लाभ',
    palette: {
      paper: '#fdf6ef',
      paperAlt: '#f6e4d4',
      ink: '#432114',
      inkSoft: '#8f6248',
      accent: '#b5502b',
      accentSoft: '#dd8b63',
      gold: '#c08b2c',
      cover: '#9c3d1d',
      coverAlt: '#5e2110',
      coverInk: '#fce7d1',
    },
    motif: 'rangoli',
    shape: 'arch',
    titleFont: DISPLAY,
    bodyFont: SERIF,
    scriptFont: DEVA,
  },
  {
    id: 'diwali-diya',
    name: 'Diwali Diya',
    occasion: 'Festival',
    blurb: 'Lamp-lit purple and amber for Diwali, Pongal, Onam and every festival at home.',
    script: 'शुभ दीपावली',
    defaultTitle: 'Festival Days',
    closingLine: 'Light, sweets and everyone home',
    closingScript: 'प्रकाश',
    palette: {
      paper: '#fdf7ef',
      paperAlt: '#f3e6e9',
      ink: '#31173a',
      inkSoft: '#7b5a86',
      accent: '#63267a',
      accentSoft: '#a566b8',
      gold: '#d9a52a',
      cover: '#41155a',
      coverAlt: '#1f0a2c',
      coverInk: '#f9e4b7',
    },
    motif: 'diya',
    shape: 'round',
    titleFont: DISPLAY,
    bodyFont: SERIF,
    scriptFont: DEVA,
  },
]

export const themeById = (id: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0]

export const PAGE_SIZES: PageSizeSpec[] = [
  { id: 'sq8', label: 'Square 8 × 8 in', w: 8, h: 8 },
  { id: 'sq12', label: 'Square 12 × 12 in (lay-flat)', w: 12, h: 12 },
  { id: 'land-a4', label: 'Landscape A4 (11.7 × 8.3 in)', w: 11.69, h: 8.27 },
  { id: 'port-a4', label: 'Portrait A4 (8.3 × 11.7 in)', w: 8.27, h: 11.69 },
  { id: 'land-10x8', label: 'Landscape 10 × 8 in', w: 10, h: 8 },
  { id: 'phone', label: 'Phone story (9 : 16)', w: 5.63, h: 10 },
]

export const pageSizeById = (id: string): PageSizeSpec => PAGE_SIZES.find((p) => p.id === id) ?? PAGE_SIZES[0]
