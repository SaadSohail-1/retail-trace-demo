import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  CircleAlert,
  CircleCheck,
  Database,
  FileStack,
  Leaf,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sprout,
} from 'lucide-react'
import {
  api,
  getErrorMessage,
  type BlockchainHealth,
  type InitializationResult,
  type IntegrationStatus,
  type RetailTraceRecord,
  type SchemaSummary,
  type SyncResult,
  type VerificationResult,
} from './services/api'
import './App.css'

type Notice = {
  kind: 'success' | 'warning' | 'error'
  message: string
}

type VerificationState = VerificationResult | { error: string }

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Unknown date'
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value
}

function recordPreview(record: RetailTraceRecord): string {
  const name = record.data.name ?? record.data.customerName
  if (typeof name === 'string') return name
  const firstValue = Object.values(record.data).find(
    (value) => typeof value === 'string' || typeof value === 'number',
  )
  return firstValue === undefined ? 'Traceability record' : String(firstValue)
}

function App() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [health, setHealth] = useState<BlockchainHealth | null>(null)
  const [schemas, setSchemas] = useState<SchemaSummary[]>([])
  const [records, setRecords] = useState<RetailTraceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshError, setRefreshError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [busyAction, setBusyAction] = useState<'initialize' | 'retry' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [retrySyncId, setRetrySyncId] = useState('')
  const [recordSearch, setRecordSearch] = useState('')
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [verificationById, setVerificationById] = useState<
    Record<string, VerificationState>
  >({})

  const refresh = useCallback(async () => {
    setLoading(true)
    setRefreshError('')

    const results = await Promise.allSettled([
      api.getIntegrationStatus(),
      api.getHealth(),
      api.getSchemas(),
      api.getRecords(),
    ])
    const failures: string[] = []

    const [statusResult, healthResult, schemaResult, recordResult] = results
    if (statusResult.status === 'fulfilled') setStatus(statusResult.value)
    else failures.push(`Status: ${getErrorMessage(statusResult.reason)}`)

    if (healthResult.status === 'fulfilled') setHealth(healthResult.value)
    else failures.push(`RetailTrace health: ${getErrorMessage(healthResult.reason)}`)

    if (schemaResult.status === 'fulfilled') setSchemas(schemaResult.value)
    else failures.push(`Schemas: ${getErrorMessage(schemaResult.reason)}`)

    if (recordResult.status === 'fulfilled') setRecords(recordResult.value)
    else failures.push(`Records: ${getErrorMessage(recordResult.reason)}`)

    setRefreshError(failures.join(' · '))
    setLastUpdated(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const schemaNameById = useMemo(
    () => new Map(schemas.map((schema) => [schema.schemaId, schema.name])),
    [schemas],
  )

  const visibleRecords = useMemo(() => {
    const query = recordSearch.trim().toLowerCase()
    if (!query) return records
    return records.filter((record) => {
      const schemaName = schemaNameById.get(record.schemaId) ?? ''
      return (
        record.recordId.toLowerCase().includes(query) ||
        schemaName.toLowerCase().includes(query) ||
        JSON.stringify(record.data).toLowerCase().includes(query)
      )
    })
  }, [recordSearch, records, schemaNameById])

  async function handleInitialize() {
    setBusyAction('initialize')
    setNotice(null)
    try {
      const result: InitializationResult = await api.initialize()
      const message =
        result.status === 'initialized'
          ? 'All schemas are ready. Existing matching schema versions were reused.'
          : `Initialization ${result.status}${result.failedAt ? ` at ${result.failedAt}` : ''}${result.error ? `: ${result.error.message}` : ''}`
      setNotice({ kind: result.status === 'initialized' ? 'success' : 'warning', message })
      await refresh()
    } catch (error) {
      setNotice({ kind: 'error', message: getErrorMessage(error) })
    } finally {
      setBusyAction(null)
    }
  }

  async function handleRetry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const syncId = retrySyncId.trim()
    if (!syncId) {
      setNotice({ kind: 'warning', message: 'Enter a local synchronization ID to retry.' })
      return
    }

    setBusyAction('retry')
    setNotice(null)
    try {
      const result: SyncResult = await api.retry(syncId)
      setNotice({
        kind: result.syncStatus === 'SYNCED' ? 'success' : 'warning',
        message:
          result.syncStatus === 'SYNCED'
            ? `${result.entityType} is synced${result.retailTraceRecordId ? ` as ${shortId(result.retailTraceRecordId)}` : ''}.`
            : `${result.entityType} retry status: ${result.syncStatus}${result.errorMessage ? ` — ${result.errorMessage}` : ''}`,
      })
      await refresh()
    } catch (error) {
      setNotice({ kind: 'error', message: getErrorMessage(error) })
    } finally {
      setBusyAction(null)
    }
  }

  async function handleVerify(recordId: string) {
    setVerifyingId(recordId)
    setVerificationById((current) => {
      const next = { ...current }
      delete next[recordId]
      return next
    })
    try {
      const result = await api.verify(recordId)
      setVerificationById((current) => ({ ...current, [recordId]: result }))
    } catch (error) {
      setVerificationById((current) => ({
        ...current,
        [recordId]: { error: getErrorMessage(error) },
      }))
    } finally {
      setVerifyingId(null)
    }
  }

  function navigateTo(section: string) {
    document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const healthConnected = health?.status === 'connected'
  const schemaCount = status
    ? Object.values(status.schemas).filter(Boolean).length
    : 0

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="Verdant Store home">
          <span className="brand-mark"><Sprout size={22} strokeWidth={2.2} /></span>
          <span className="brand-copy">
            <strong>verdant</strong>
            <small>STORE CONSOLE</small>
          </span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Dashboard sections">
          <button className="nav-item active" onClick={() => navigateTo('overview')}>
            <Activity size={18} />
            <span>Overview</span>
          </button>
          <button className="nav-item" onClick={() => navigateTo('schemas')}>
            <FileStack size={18} />
            <span>RetailTrace schemas</span>
          </button>
          <button className="nav-item" onClick={() => navigateTo('records')}>
            <Database size={18} />
            <span>Published records</span>
          </button>
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <span className="note-icon"><Leaf size={17} /></span>
          <div>
            <strong>Built for better sourcing</strong>
            <p>Business data stays in Verdant Store. Trace records are verified by RetailTrace.</p>
          </div>
        </div>
        <div className="sidebar-footer">
          <span className="live-dot" />
          <span>Local demonstration</span>
        </div>
      </aside>

      <main className="main-content" id="top">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Verdant Store</span>
            <span className="breadcrumb-divider">/</span>
            <strong>Integration dashboard</strong>
          </div>
          <div className="topbar-actions">
            <span className={`connection-pill ${healthConnected ? 'is-connected' : ''}`}>
              <span className="connection-dot" />
              {health ? (healthConnected ? 'RetailTrace connected' : `RetailTrace ${health.status}`) : 'Checking RetailTrace'}
            </span>
            <button
              className="icon-button"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="Refresh dashboard"
              title="Refresh dashboard"
            >
              <RefreshCw size={17} className={loading ? 'spin' : ''} />
            </button>
          </div>
        </header>

        <div className="page-content">
          <section className="page-heading" id="overview">
            <div>
              <div className="eyebrow"><span /> TRACEABILITY WORKSPACE</div>
              <h1>Good products.<br /><em>Clear provenance.</em></h1>
              <p className="page-description">
                Connect Verdant Store’s business records to RetailTrace and keep every
                supplier relationship easy to follow.
              </p>
            </div>
            <div className="heading-actions">
              <span className="last-updated">
                {lastUpdated ? `Updated ${formatDate(lastUpdated.toISOString())}` : 'Loading data'}
              </span>
              <button
                className="button button-primary"
                onClick={() => void handleInitialize()}
                disabled={busyAction !== null}
              >
                {busyAction === 'initialize' ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <ArrowDownToLine size={17} />
                )}
                Initialize schemas
              </button>
            </div>
          </section>

          {refreshError && (
            <div className="notice notice-error" role="alert">
              <CircleAlert size={18} />
              <span>{refreshError}</span>
              <button className="text-button" onClick={() => void refresh()}>Try again</button>
            </div>
          )}
          {notice && (
            <div className={`notice notice-${notice.kind}`} role="status">
              {notice.kind === 'success' ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
              <span>{notice.message}</span>
              <button className="notice-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss message">×</button>
            </div>
          )}

          <section className="metrics-grid" aria-label="Integration summary">
            <article className="metric-card metric-primary">
              <div className="metric-topline">
                <span>Integration status</span>
                <span className="metric-icon"><ShieldCheck size={19} /></span>
              </div>
              <div className="metric-value">
                {loading && !status ? '—' : status?.initialized ? 'Ready' : status?.status === 'partial' ? 'Partial' : 'Not set up'}
              </div>
              <div className="metric-foot">
                <span className={`mini-dot ${status?.initialized ? 'green' : 'amber'}`} />
                {status?.initialized ? 'Schemas registered' : 'Initialize to connect schemas'}
              </div>
            </article>

            <article className="metric-card">
              <div className="metric-topline">
                <span>Registered schemas</span>
                <span className="metric-icon metric-icon-neutral"><FileStack size={18} /></span>
              </div>
              <div className="metric-value">{loading && !status ? '—' : `${schemaCount}`}<small> / 3</small></div>
              <div className="metric-foot">Supplier · Product · Order</div>
            </article>

            <article className="metric-card">
              <div className="metric-topline">
                <span>Synced records</span>
                <span className="metric-icon metric-icon-neutral"><Database size={18} /></span>
              </div>
              <div className="metric-value">{loading && !status ? '—' : status?.synchronization.synced ?? 0}</div>
              <div className="metric-foot">
                <span className="mini-dot green" />
                {status?.synchronization.failed ?? 0} failed · {status?.synchronization.pending ?? 0} pending
              </div>
            </article>

            <article className="metric-card">
              <div className="metric-topline">
                <span>Blockchain health</span>
                <span className="metric-icon metric-icon-neutral"><Activity size={18} /></span>
              </div>
              <div className="metric-value health-value">
                {health ? health.status : loading ? 'Checking' : 'Unavailable'}
              </div>
              <div className="metric-foot">
                {health ? `Checked ${formatDate(health.checkedAt)}` : 'Check backend configuration'}
              </div>
            </article>
          </section>

          <section className="journey-card" aria-label="Record publishing flow">
            <div className="journey-heading">
              <div>
                <div className="eyebrow muted-eyebrow">HOW YOUR DATA FLOWS</div>
                <h2>One clear chain of custody</h2>
              </div>
              <span className="journey-caption">Business data → traceable records</span>
            </div>
            <div className="journey-flow">
              <div className="journey-step">
                <span className="journey-number">01</span>
                <span className="journey-icon"><Leaf size={19} /></span>
                <div><strong>Supplier</strong><small>Origin details</small></div>
                <span className="step-state">{status?.schemas.supplierSchemaId ? 'Registered' : 'Waiting'}</span>
              </div>
              <ArrowRight className="journey-arrow" size={18} />
              <div className="journey-step">
                <span className="journey-number">02</span>
                <span className="journey-icon"><Sprout size={19} /></span>
                <div><strong>Product</strong><small>Linked to supplier</small></div>
                <span className="step-state">{status?.schemas.productSchemaId ? 'Registered' : 'Waiting'}</span>
              </div>
              <ArrowRight className="journey-arrow" size={18} />
              <div className="journey-step journey-pending">
                <span className="journey-number">03</span>
                <span className="journey-icon"><FileStack size={19} /></span>
                <div><strong>Order</strong><small>Multi-item design needed</small></div>
                <span className="step-state pending-state">Pending design</span>
              </div>
            </div>
          </section>

          <div className="content-grid">
            <section className="panel schemas-panel" id="schemas">
              <div className="panel-header">
                <div>
                  <div className="eyebrow muted-eyebrow">SCHEMA REGISTRY</div>
                  <h2>Registered schemas</h2>
                </div>
                <span className="count-badge">{schemas.length}</span>
              </div>
              <p className="panel-description">
                Versioned RetailTrace schemas define the fields accepted for each business record.
              </p>
              <div className="schema-list">
                {schemas.length === 0 ? (
                  <div className="empty-state">
                    <FileStack size={21} />
                    <strong>No schemas loaded</strong>
                    <span>Initialize schemas or refresh the dashboard.</span>
                  </div>
                ) : (
                  schemas.map((schema) => (
                    <div className="schema-row" key={schema.schemaId}>
                      <span className="schema-symbol"><FileStack size={17} /></span>
                      <div className="schema-details">
                        <strong>{schema.name}</strong>
                        <code title={schema.schemaId}>{shortId(schema.schemaId)}</code>
                      </div>
                      <span className="version-pill">v{schema.version}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="panel-footnote">
                <span className="mini-dot green" />
                Schema IDs are stored in the local IntegrationConfig row.
              </div>
            </section>

            <section className="panel retry-panel">
              <div className="panel-header">
                <div>
                  <div className="eyebrow muted-eyebrow">RECOVERY</div>
                  <h2>Retry a sync</h2>
                </div>
                <span className="retry-icon"><RefreshCw size={18} /></span>
              </div>
              <p className="panel-description">
                Retry a failed Supplier or Product submission using its local sync ID.
              </p>
              <form className="retry-form" onSubmit={(event) => void handleRetry(event)}>
                <label htmlFor="sync-id">Synchronization ID</label>
                <div className="input-action">
                  <input
                    id="sync-id"
                    value={retrySyncId}
                    onChange={(event) => setRetrySyncId(event.target.value)}
                    placeholder="Paste a RetailTraceSync ID"
                    autoComplete="off"
                  />
                  <button
                    className="button button-dark"
                    type="submit"
                    disabled={busyAction !== null}
                    aria-label="Retry synchronization"
                  >
                    {busyAction === 'retry' ? <LoaderCircle size={17} className="spin" /> : <RefreshCw size={17} />}
                  </button>
                </div>
              </form>
              <div className="retry-help">
                <CircleAlert size={15} />
                <span>Find failed sync IDs in the PostgreSQL <code>RetailTraceSync</code> table.</span>
              </div>
            </section>
          </div>

          <section className="panel records-panel" id="records">
            <div className="panel-header records-header">
              <div>
                <div className="eyebrow muted-eyebrow">RETAILTRACE LEDGER</div>
                <h2>Published records</h2>
              </div>
              <label className="search-box">
                <Search size={16} />
                <input
                  type="search"
                  value={recordSearch}
                  onChange={(event) => setRecordSearch(event.target.value)}
                  placeholder="Search records"
                  aria-label="Search published records"
                />
              </label>
            </div>
            <p className="panel-description">
              Records returned by RetailTrace for the configured business. Verify a record to check its blockchain status.
            </p>
            <div className="records-table-wrap">
              <table className="records-table">
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>Schema</th>
                    <th>RetailTrace status</th>
                    <th>Published</th>
                    <th>Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.map((record) => {
                    const verification = verificationById[record.recordId]
                    return (
                      <tr key={record.recordId}>
                        <td>
                          <div className="record-name">{recordPreview(record)}</div>
                          <code className="record-id" title={record.recordId}>{shortId(record.recordId)}</code>
                        </td>
                        <td>
                          <span className="schema-name">{schemaNameById.get(record.schemaId) ?? 'Unknown schema'}</span>
                        </td>
                        <td>
                          <span className={`record-status status-${record.status.toLowerCase()}`}>
                            <span />
                            {record.status}
                          </span>
                        </td>
                        <td className="record-date">{formatDate(record.createdAt)}</td>
                        <td>
                          {verification && 'error' in verification ? (
                            <span className="verification-error" title={verification.error}>Unavailable</span>
                          ) : verification ? (
                            <span className={`verified-state ${verification.verified ? 'verified' : 'not-verified'}`}>
                              {verification.verified ? <Check size={14} /> : <CircleAlert size={14} />}
                              {verification.verified ? 'Verified' : 'Not verified'}
                            </span>
                          ) : (
                            <button
                              className="verify-button"
                              onClick={() => void handleVerify(record.recordId)}
                              disabled={verifyingId === record.recordId}
                            >
                              {verifyingId === record.recordId ? (
                                <LoaderCircle size={14} className="spin" />
                              ) : (
                                <ShieldCheck size={15} />
                              )}
                              Verify
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {visibleRecords.length === 0 && (
                    <tr>
                      <td colSpan={5}>
                        <div className="empty-table">
                          {records.length === 0
                            ? 'No RetailTrace records are available yet.'
                            : 'No records match this search.'}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="records-footer">
              <span>Showing {visibleRecords.length} of {records.length} records</span>
              <span><span className="mini-dot green" /> Data is read from RetailTrace</span>
            </div>
          </section>

          <footer className="page-footer">
            <span><Sprout size={15} /> Verdant Store · Traceability demo</span>
            <span>Business data in PostgreSQL <span className="footer-separator">·</span> Verification by RetailTrace</span>
          </footer>
        </div>
      </main>
    </div>
  )
}

export default App
