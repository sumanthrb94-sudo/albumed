/* Sheets, paper and price.

   An Indian studio does not sell "an album", it sells sheets of photo paper
   bound together. One album page = one printed sheet, so the sheet count comes
   straight out of the layout engine and the price follows from it.

   Two ways to end up paying, and the customer picks:
     - order the printed album from the studio, or
     - download the print-ready PDF and take it to their own press.
   The download is the product, so it is priced, not given away. A couple of
   sheets are free so anyone can hold the real thing before deciding. */

export interface PaperSpec {
  id: string
  label: string
  /** Trim size in inches. */
  w: number
  h: number
  /** What a studio charges to print one sheet, in paise. */
  ratePaise: number
  /** Roughly how many photos sit on a sheet this size at balanced density. */
  typicalPhotos: number
  note: string
}

/* Rates checked against Indian album printers, Sept 2026: a 12x36 lay-flat
   sheet runs about Rs 450 hardbound at the volume end and into the thousands
   for archival silver-halide; budget books sit at Rs 499-1,999 all-in. These
   sit at the mid-premium mark a studio would quote a wedding client.
   Indicative while we are designing — not a price list. */
export const PAPERS: PaperSpec[] = [
  {
    id: 'sheet-12x36',
    label: '12 × 36 in lay-flat spread',
    w: 36,
    h: 12,
    ratePaise: 45000,
    typicalPhotos: 5,
    note: 'Opens flat with no gutter. The 2026 default for a wedding album.',
  },
  {
    id: 'sheet-12x18',
    label: '12 × 18 in',
    w: 18,
    h: 12,
    ratePaise: 28000,
    typicalPhotos: 4,
    note: 'The common album sheet. Good balance of size and cost.',
  },
  {
    id: 'sheet-12x12',
    label: '12 × 12 in square',
    w: 12,
    h: 12,
    ratePaise: 22000,
    typicalPhotos: 3,
    note: 'Square lay-flat, popular for reception albums.',
  },
  {
    id: 'sheet-8x12',
    label: '8 × 12 in',
    w: 12,
    h: 8,
    ratePaise: 12000,
    typicalPhotos: 3,
    note: 'Smaller parent copy, or a gift album.',
  },
  {
    id: 'sheet-a4',
    label: 'A4',
    w: 11.69,
    h: 8.27,
    ratePaise: 8000,
    typicalPhotos: 3,
    note: 'Cheapest. Fine for a proof copy.',
  },
]

export const paperById = (id: string): PaperSpec => PAPERS.find((p) => p.id === id) ?? PAPERS[1]

export interface FinishSpec {
  id: string
  label: string
  /** Multiplier on the sheet rate. */
  factor: number
}

export const FINISHES: FinishSpec[] = [
  { id: 'matte', label: 'Matte', factor: 1 },
  { id: 'glossy', label: 'Glossy', factor: 1.05 },
  { id: 'lustre', label: 'Lustre / velvet', factor: 1.2 },
  { id: 'metallic', label: 'Metallic', factor: 1.45 },
]

export const finishById = (id: string): FinishSpec => FINISHES.find((f) => f.id === id) ?? FINISHES[0]

export interface BindingSpec {
  id: string
  label: string
  pricePaise: number
}

export const BINDINGS: BindingSpec[] = [
  { id: 'none', label: 'Loose sheets, no binding', pricePaise: 0 },
  { id: 'softcover', label: 'Softcover bound', pricePaise: 90000 },
  { id: 'hardcover', label: 'Hardcover, padded', pricePaise: 180000 },
  { id: 'box', label: 'Hardcover in a wooden box', pricePaise: 450000 },
]

export const bindingById = (id: string): BindingSpec => BINDINGS.find((b) => b.id === id) ?? BINDINGS[1]

/** How many sheets anyone gets without paying, so they can hold the real thing. */
export const FREE_SHEETS = 2

/** The PDF is the product when a customer takes it to their own press. */
const PDF_BASE_PAISE = 29900
const PDF_PER_SHEET_PAISE = 2500

export interface PrintOrder {
  paperId: string
  finishId: string
  bindingId: string
  copies: number
}

export const defaultOrder = (): PrintOrder => ({
  paperId: 'sheet-12x18',
  finishId: 'matte',
  bindingId: 'softcover',
  copies: 1,
})

export interface Quote {
  sheets: number
  /** Sheets you can take without paying. */
  freeSheets: number
  /** Sheets that have to be paid for. */
  paidSheets: number
  paper: PaperSpec
  finish: FinishSpec
  binding: BindingSpec
  copies: number
  /** Printing the sheets, one copy. */
  sheetsPaise: number
  /** Printed and bound, all copies. */
  printTotalPaise: number
  /** Downloading the print-ready PDF instead. */
  pdfPaise: number
  /** True when the album fits inside the free allowance. */
  freeAlbum: boolean
}

export function quote(sheets: number, order: PrintOrder): Quote {
  const paper = paperById(order.paperId)
  const finish = finishById(order.finishId)
  const binding = bindingById(order.bindingId)
  const copies = Math.max(1, Math.min(50, Math.round(order.copies)))

  const freeSheets = Math.min(FREE_SHEETS, sheets)
  const paidSheets = Math.max(0, sheets - freeSheets)
  const perSheet = Math.round(paper.ratePaise * finish.factor)
  const sheetsPaise = perSheet * sheets
  const printTotalPaise = (sheetsPaise + binding.pricePaise) * copies

  return {
    sheets,
    freeSheets,
    paidSheets,
    paper,
    finish,
    binding,
    copies,
    sheetsPaise,
    printTotalPaise,
    pdfPaise: paidSheets === 0 ? 0 : PDF_BASE_PAISE + PDF_PER_SHEET_PAISE * paidSheets,
    freeAlbum: paidSheets === 0,
  }
}

export const rupees = (paise: number): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    paise / 100,
  )

/** Which page size the layout engine should use for a given paper. */
export const pageSizeForPaper = (paper: PaperSpec) => ({ w: paper.w, h: paper.h })
