/* Which assistant answers.

   A real Gemini key wins, then a real Claude key, then demo mode. Keeping the
   decision here means the routes never branch on provider, and swapping one in
   is a one-line change rather than a refactor. */
import * as claude from './claude.js'
import * as gemini from './gemini.js'
import { demoMode } from './demoAi.js'

export type ProviderId = 'gemini' | 'claude' | 'demo' | 'off'

export function providerId(): ProviderId {
  if (gemini.geminiConfigured()) return 'gemini'
  if (claude.aiConfigured()) return 'claude'
  return demoMode() ? 'demo' : 'off'
}

export function modelLabel(): string {
  switch (providerId()) {
    case 'gemini':
      return gemini.GEMINI_MODEL
    case 'claude':
      return claude.MODEL
    case 'demo':
      return 'demo mode — scripted'
    default:
      return claude.MODEL
  }
}

/** The live provider, for the routes. Demo mode is handled before this is called. */
export const live = () => (providerId() === 'gemini' ? gemini : claude)
