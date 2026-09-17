import { useCallback, useEffect, useState } from 'react'
import { AppProvider, useApp } from './store'
import { Home } from './screens/Home'
import { Upload } from './screens/Upload'
import { Review } from './screens/Review'
import { Design } from './screens/Design'
import { AlbumView } from './screens/AlbumView'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Paywall } from './components/Paywall'
import { SignIn, displayPhone } from './screens/SignIn'
import { currentSession, signOut, type Session } from './lib/auth'

type Tab = 'upload' | 'review' | 'design' | 'album'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'upload', label: 'Add photos' },
  { id: 'review', label: 'Review' },
  { id: 'design', label: 'Template' },
  { id: 'album', label: 'Album' },
]

interface Route {
  name: 'home' | 'project'
  projectId?: string
  tab: Tab
}

function parseHash(): Route {
  const m = /^#\/p\/([^/]+)(?:\/(upload|review|design|album))?/.exec(window.location.hash)
  if (m) return { name: 'project', projectId: m[1], tab: (m[2] as Tab) ?? 'upload' }
  return { name: 'home', tab: 'upload' }
}

function useHashRoute(): [Route, (hash: string) => void] {
  const [route, setRoute] = useState<Route>(parseHash)
  useEffect(() => {
    const on = () => setRoute(parseHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const nav = useCallback((hash: string) => {
    if (window.location.hash === hash) setRoute(parseHash())
    else window.location.hash = hash
    window.scrollTo({ top: 0 })
  }, [])
  return [route, nav]
}

function InstallButton() {
  const [evt, setEvt] = useState<Event & { prompt?: () => Promise<void> } | null>(null)
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault()
      setEvt(e as Event & { prompt?: () => Promise<void> })
    }
    window.addEventListener('beforeinstallprompt', on)
    return () => window.removeEventListener('beforeinstallprompt', on)
  }, [])
  if (!evt) return null
  return (
    <button
      className="btn sm ghost"
      style={{ color: '#f7e6c4', borderColor: 'rgba(255,255,255,.4)' }}
      onClick={() => {
        evt.prompt?.()
        setEvt(null)
      }}
    >
      ⬇ Install app
    </button>
  )
}

function Account({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="account">
      <button
        className="account-chip"
        data-testid="account-phone"
        data-phone={displayPhone(session.phone)}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account ${displayPhone(session.phone)}`}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden focusable="false">
          <circle cx="8" cy="5" r="3" fill="currentColor" />
          <path d="M2 15a6 6 0 0 1 12 0Z" fill="currentColor" />
        </svg>
        {/* The full number on a laptop, the memorable tail on a phone. */}
        <b className="full">{displayPhone(session.phone)}</b>
        <b className="short" aria-hidden>{session.phone.slice(-5)}</b>
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <p className="hint">Signed in on this device. Your albums live here, not on a server.</p>
          <button
            className="btn sm"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onSignOut()
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function Shell({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const app = useApp()
  const [route, nav] = useHashRoute()
  const project = app.project

  useEffect(() => {
    if (route.name === 'project' && route.projectId && route.projectId !== app.project?.id) {
      app.openProject(route.projectId)
    }
    if (route.name === 'home' && app.project) app.closeProject()
  }, [route, app])

  const finalized = project?.status === 'finalized'
  const approved = app.photos.filter((p) => p.status === 'approved').length

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="brand"
          style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
          onClick={() => nav('#/')}
          aria-label="Albumed home"
        >
          <img src="/icon-192.png" alt="" />
          <div style={{ textAlign: 'left' }}>
            <h1>Albumed</h1>
            <div className="sub">एल्बम बनाइए</div>
          </div>
        </button>
        <span className="spacer" />
        {project && <span className={`chip status ${project.status}`}>{project.status === 'collecting' ? 'Collecting' : project.status === 'review' ? 'In review' : 'Finalized'}</span>}
        <button
          className={`plan-chip${app.plan.limits.printGrade ? ' paid' : ''}`}
          onClick={() =>
            app.showPaywall(
              app.plan.limits.printGrade
                ? { reason: 'Your plan', detail: `You are on ${app.plan.name}.` }
                : { reason: 'Your photos are being compressed', detail: 'Free albums store a smaller copy of each photo. Subscribe to keep them at print quality.' },
            )
          }
        >
          {app.plan.limits.printGrade ? `★ ${app.plan.name}` : 'Free'}
        </button>
        {app.ai.demo && <span className="chip demo" title="The assistant is returning scripted replies">Demo AI</span>}
        <InstallButton />
        <Account session={session} onSignOut={onSignOut} />
      </header>

      {route.name === 'project' && project && (
        <nav className="steps" aria-label="Album steps">
          {TABS.map((t, i) => {
            const locked = (t.id === 'design' || t.id === 'album') && !finalized
            const done =
              (t.id === 'upload' && app.photos.length > 0) ||
              (t.id === 'review' && finalized) ||
              (t.id === 'design' && finalized && Boolean(app.album))
            return (
              <button
                key={t.id}
                className={`step${route.tab === t.id ? ' active' : ''}${done ? ' done' : ''}`}
                disabled={locked}
                title={locked ? 'Confirm your photo selection first' : undefined}
                onClick={() => nav(`#/p/${project.id}/${t.id}`)}
              >
                <span className="n">{done ? '✓' : i + 1}</span>
                <b>{t.label}</b>
              </button>
            )
          })}
        </nav>
      )}

      {route.name === 'home' && <Home nav={nav} />}
      {route.name === 'project' && !project && (
        <div className="wrap">
          <div className="card empty">Loading album…</div>
        </div>
      )}
      {route.name === 'project' && project && (
        <>
          {route.tab === 'upload' && <Upload nav={nav} />}
          {route.tab === 'review' && <Review nav={nav} />}
          {route.tab === 'design' && (finalized ? <Design nav={nav} /> : <LockedNotice approved={approved} nav={nav} id={project.id} />)}
          {route.tab === 'album' && (finalized ? <AlbumView nav={nav} /> : <LockedNotice approved={approved} nav={nav} id={project.id} />)}
        </>
      )}

      {app.progress && (
        <div className="progress-wrap">
          <div className="progress">
            <b>{app.progress.label}</b>
            <div className="hint">
              {app.progress.done} of {app.progress.total}
            </div>
            <div className="bar">
              <i style={{ width: `${Math.round((app.progress.done / Math.max(1, app.progress.total)) * 100)}%` }} />
            </div>
          </div>
        </div>
      )}

      <Paywall />
      {app.toast && <div className="toast">{app.toast}</div>}
    </div>
  )
}

function LockedNotice({ approved, nav, id }: { approved: number; nav: (h: string) => void; id: string }) {
  return (
    <div className="wrap">
      <div className="card empty">
        <div className="om">॥ ॐ ॥</div>
        <p>
          The album is generated once the selection is confirmed.
          {approved ? ` You have ${approved} approved photos ready.` : ' Approve some photos first.'}
        </p>
        <button className="btn primary" onClick={() => nav(`#/p/${id}/review`)}>
          Go to review &amp; finalize
        </button>
      </div>
    </div>
  )
}

export default function App() {
  // The session gate sits outside the provider: with nobody signed in there is
  // no reason to open the database at all.
  const [session, setSession] = useState<Session | null>(() => currentSession())

  return (
    <ErrorBoundary>
      {session ? (
        <AppProvider>
          <Shell
            session={session}
            onSignOut={() => {
              signOut()
              setSession(null)
              window.location.hash = ''
            }}
          />
        </AppProvider>
      ) : (
        <SignIn onSignedIn={() => setSession(currentSession())} />
      )}
    </ErrorBoundary>
  )
}
