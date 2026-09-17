import { useState } from 'react'
import { useApp } from '../store'
import { checkoutFor, formatInr, periodLabel, PLANS, type PlanId } from '../lib/plan'
import { QualityCompare } from './QualityCompare'

/** The subscribe sheet. Payment is stubbed for the design stage — `checkoutFor`
 *  is the seam a provider (Razorpay, Stripe) drops into. */
export function Paywall() {
  const app = useApp()
  const [busy, setBusy] = useState<PlanId | null>(null)
  const wall = app.paywall
  if (!wall) return null

  const sample = app.photos.find((p) => p.hasSample)

  const choose = async (id: PlanId) => {
    setBusy(id)
    const order = checkoutFor(id)
    // Where a real checkout goes. The reference and amount are already what a
    // provider would be handed; nothing else about the flow changes.
    console.info('checkout', order)
    await new Promise((r) => setTimeout(r, 450))
    app.setPlan(id)
    setBusy(null)
  }

  return (
    <div className="paywall" role="dialog" aria-modal="true" aria-label="Subscribe">
      <div className="paywall-sheet">
        <button className="paywall-close" onClick={app.dismissPaywall} aria-label="Close">
          ✕
        </button>
        <div className="deva">॥ शुभ ॥</div>
        <h2>{wall.reason}</h2>
        <p className="hint">{wall.detail}</p>

        {sample && !app.plan.limits.printGrade && (
          <div style={{ margin: '16px 0' }}>
            <QualityCompare photo={sample} />
          </div>
        )}

        <div className="plan-grid">
          {(['free', 'plus', 'studio'] as PlanId[]).map((id) => {
            const p = PLANS[id]
            const current = app.plan.id === id
            return (
              <div key={id} data-plan={id} className={`plan${current ? ' current' : ''}${id === 'plus' ? ' featured' : ''}`}>
                {id === 'plus' && <span className="ribbon">Most families pick this</span>}
                <h3>{p.name}</h3>
                <div className="price">
                  {p.priceInr === 0 ? 'Free' : formatInr(p.priceInr)}
                  <span>{periodLabel(p.period)}</span>
                </div>
                <p className="hint">{p.tagline}</p>
                <ul>
                  {p.perks.map((perk) => (
                    <li key={perk}>{perk}</li>
                  ))}
                </ul>
                <button
                  className={`btn block ${id === 'plus' ? 'gold' : current ? 'ghost' : ''}`}
                  disabled={current || busy !== null}
                  onClick={() => choose(id)}
                >
                  {current ? 'Your plan' : busy === id ? 'One moment…' : p.priceInr === 0 ? 'Stay on Free' : 'Subscribe'}
                </button>
              </div>
            )
          })}
        </div>

        <p className="hint" style={{ marginTop: 14 }}>
          Prices are indicative while we design this. Payments are not live yet — choosing a plan here
          switches it on so you can see the difference.
        </p>
      </div>
    </div>
  )
}
