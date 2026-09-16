import type { VercelRequest, VercelResponse } from '@vercel/node'
import { aiHandler } from '../../server/vercel'

/** Claude's vision and planning passes take longer than the default limit. */
export const config = { maxDuration: 60 }

export default (req: VercelRequest, res: VercelResponse) => aiHandler('curate', req, res)
