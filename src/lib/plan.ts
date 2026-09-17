/* Plans and what each one is allowed to do.

   The whole product rests on one honest trade: a free album stores a
   *compressed* copy of each photo, so it prints soft. The original never
   leaves the phone's gallery — subscribing is how you get the real thing into
   the album. Everything here is the single place that decides what a plan
   gets; nothing else in the app hardcodes a limit. */

export type PlanId = 'free' | 'plus' | 'studio'

export interface PlanLimits {
  /** Longest edge kept on import. */
  ingestMaxPx: number
  /** JPEG quality kept on import. */
  ingestQuality: number
  /** Highest export resolution offered. */
  maxExportDpi: number
  /** Stamp exported pages. */
  watermark: boolean
  maxPhotosPerAlbum: number
  /** How many photos the assistant will review, per album. 0 = no assistant. */
  aiPhotoLimit: number
  /** Whether imports keep print-grade detail. */
  printGrade: boolean
}

export interface Plan {
  id: PlanId
  name: string
  tagline: string
  /** Rupees. Indicative pricing for the design stage. */
  priceInr: number
  period: 'free' | 'month' | 'year'
  limits: PlanLimits
  perks: string[]
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Build the whole album and see exactly how it will look.',
    priceInr: 0,
    period: 'free',
    limits: {
      ingestMaxPx: 1280,
      ingestQuality: 0.62,
      maxExportDpi: 150,
      watermark: true,
      maxPhotosPerAlbum: 60,
      // Measured: reviewing 60 photos costs about Rs 15. The assistant is not
      // what this business pays for, so the free tier reviews everything it is
      // allowed to hold — the paywall is about print quality, not about tokens.
      aiPhotoLimit: 60,
      printGrade: false,
    },
    perks: [
      'Up to 60 photos in an album',
      'Every template, every layout',
      'The assistant reviews every photo you add',
      'Photos are stored compressed — fine on screen, soft in print',
      'Draft PDF at 150 dpi, with a watermark',
    ],
  },
  plus: {
    id: 'plus',
    name: 'Plus',
    tagline: 'Your photos at their real quality, ready for the press.',
    priceInr: 249,
    period: 'month',
    limits: {
      ingestMaxPx: 4000,
      ingestQuality: 0.94,
      maxExportDpi: 300,
      watermark: false,
      maxPhotosPerAlbum: 600,
      aiPhotoLimit: Number.POSITIVE_INFINITY,
      printGrade: true,
    },
    perks: [
      'Photos kept at print quality, up to 4000px',
      'Re-import your originals to upgrade albums you already made',
      '300 dpi PDF, no watermark',
      'Up to 600 photos in an album',
      'The assistant reviews every photo',
    ],
  },
  studio: {
    id: 'studio',
    name: 'Studio',
    tagline: 'For photographers handing albums to clients.',
    priceInr: 5999,
    period: 'year',
    limits: {
      ingestMaxPx: 6000,
      ingestQuality: 0.96,
      maxExportDpi: 600,
      watermark: false,
      maxPhotosPerAlbum: 3000,
      aiPhotoLimit: Number.POSITIVE_INFINITY,
      printGrade: true,
    },
    perks: [
      'Everything in Plus',
      'Photos kept up to 6000px, 600 dpi export',
      'Up to 3000 photos in an album',
      'Unlimited albums and client handover files',
    ],
  },
}

export const planOf = (id: PlanId | undefined): Plan => PLANS[id ?? 'free'] ?? PLANS.free

const KEY = 'albumed.plan'

/** The plan lives on the device. A real deployment would read it from the
 *  account after a payment provider confirms — see `activatePlan`. */
/* A plan belongs to an account, not to a browser: a studio and the family it
   sent to share one device in this demo, and the studio paying must not quietly
   put the family on a paid plan too. */
const planKey = (phone?: string) => (phone ? `${KEY}.${phone}` : KEY)

export function readPlan(phone?: string): PlanId {
  try {
    const v = localStorage.getItem(planKey(phone))
    if (v === 'plus' || v === 'studio' || v === 'free') return v
  } catch {
    /* private window, blocked storage */
  }
  return 'free'
}

export function writePlan(id: PlanId, phone?: string): void {
  try {
    localStorage.setItem(planKey(phone), id)
  } catch {
    /* nothing we can do; the session keeps it in memory */
  }
}

export interface Checkout {
  planId: PlanId
  /** What a payment provider would be handed. */
  amountPaise: number
  currency: 'INR'
  reference: string
}

export function checkoutFor(planId: PlanId): Checkout {
  const plan = planOf(planId)
  return {
    planId,
    amountPaise: plan.priceInr * 100,
    currency: 'INR',
    reference: `albumed_${planId}_${Date.now().toString(36)}`,
  }
}

export const formatInr = (rupees: number): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(rupees)

export const periodLabel = (p: Plan['period']): string =>
  p === 'free' ? '' : p === 'month' ? ' / month' : ' / year'

/** Export resolutions a plan may choose from. */
export function exportDpiOptions(planId: PlanId): Array<{ dpi: number; label: string; locked: boolean }> {
  const max = planOf(planId).limits.maxExportDpi
  return [
    { dpi: 96, label: 'Screen 96 dpi', locked: false },
    { dpi: 150, label: 'Draft 150 dpi', locked: 150 > max },
    { dpi: 300, label: 'Print 300 dpi', locked: 300 > max },
    { dpi: 600, label: 'Large format 600 dpi', locked: 600 > max },
  ]
}
