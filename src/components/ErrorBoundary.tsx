import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** A crash must not cost someone their photos — they are still in IndexedDB. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Albumed crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="wrap">
        <div className="card">
          <h2>Something went wrong</h2>
          <p className="hint">
            Your photos and albums are safe — they are stored on this device, not in the page. Reloading usually fixes
            it.
          </p>
          <pre
            style={{
              background: 'var(--paper-2)',
              padding: 12,
              borderRadius: 10,
              overflowX: 'auto',
              fontSize: 12,
            }}
          >
            {this.state.error.message}
          </pre>
          <div className="row">
            <button className="btn primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                window.location.hash = '#/'
                this.setState({ error: null })
              }}
            >
              Back to my albums
            </button>
          </div>
        </div>
      </div>
    )
  }
}
