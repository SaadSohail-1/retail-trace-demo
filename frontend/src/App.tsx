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
  type SupplierView,
  type ProductView,
  type OrderView,
  type VerificationResult,
  type SchemaDetail,
  type CompatibilityReport,
} from './services/api'
import './App.css'

type Notice = {
  kind: 'success' | 'warning' | 'error'
  message: string
}

type VerificationState = VerificationResult | { error: string }

type BusinessSyncRow = {
  key: string
  label: string
  entityType: string
  synchronization: SyncResult | null
}

function synchronizationLabel(sync: SyncResult | null): {
  label: string
  tone: 'confirmed' | 'failed' | 'pending' | 'unknown'
} {
  if (!sync) return { label: 'Not synchronized', tone: 'unknown' }
  if (sync.retailTraceStatus === 'CONFIRMED') {
    return sync.transactionId
      ? { label: 'Blockchain confirmed', tone: 'confirmed' }
      : { label: 'Confirmation details missing', tone: 'unknown' }
  }
  if (sync.retailTraceStatus === 'FAILED') {
    return { label: 'Publication failed', tone: 'failed' }
  }
  if (sync.retailTraceStatus === 'PENDING') {
    return { label: 'Awaiting blockchain confirmation', tone: 'pending' }
  }
  if (sync.submissionUncertain) {
    return { label: 'Publication outcome unknown', tone: 'unknown' }
  }
  if (sync.syncStatus === 'FAILED') return { label: 'Synchronization failed', tone: 'failed' }
  if (sync.retailTraceRecordId) return { label: 'Blockchain status unknown', tone: 'unknown' }
  if (sync.syncStatus === 'PENDING') return { label: 'Awaiting submission', tone: 'pending' }
  return { label: 'RetailTrace record ID unavailable', tone: 'unknown' }
}

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

export function AdminDashboard() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [health, setHealth] = useState<BlockchainHealth | null>(null)
  const [schemas, setSchemas] = useState<SchemaSummary[]>([])
  const [records, setRecords] = useState<RetailTraceRecord[]>([])
  const [businessSyncRows, setBusinessSyncRows] = useState<BusinessSyncRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshError, setRefreshError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [busyAction, setBusyAction] = useState<'initialize' | 'sync' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [recordSearch, setRecordSearch] = useState('')
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [verificationById, setVerificationById] = useState<
    Record<string, VerificationState>
  >({})
  const [schemaDetail, setSchemaDetail] = useState<SchemaDetail | null>(null)
  const [compatibility, setCompatibility] = useState<CompatibilityReport | null>(null)
  const [schemaUploadError, setSchemaUploadError] = useState('')
  const [schemaUploadSuccess, setSchemaUploadSuccess] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setRefreshError('')

    const results = await Promise.allSettled([
      api.getIntegrationStatus(),
      api.getHealth(),
      api.getSchemas(),
      api.getRecords(),
      api.getSuppliers(),
      api.getProducts(),
      api.getOrders(),
    ])
    const failures: string[] = []

    const [
      statusResult,
      healthResult,
      schemaResult,
      recordResult,
      supplierResult,
      productResult,
      orderResult,
    ] = results
    if (statusResult.status === 'fulfilled') setStatus(statusResult.value)
    else failures.push(`Status: ${getErrorMessage(statusResult.reason)}`)

    if (healthResult.status === 'fulfilled') setHealth(healthResult.value)
    else failures.push(`RetailTrace health: ${getErrorMessage(healthResult.reason)}`)

    if (schemaResult.status === 'fulfilled') setSchemas(schemaResult.value)
    else failures.push(`Schemas: ${getErrorMessage(schemaResult.reason)}`)

    if (recordResult.status === 'fulfilled') setRecords(recordResult.value)
    else failures.push(`Records: ${getErrorMessage(recordResult.reason)}`)

    const suppliers: SupplierView[] =
      supplierResult.status === 'fulfilled' ? supplierResult.value : []
    const products: ProductView[] =
      productResult.status === 'fulfilled' ? productResult.value : []
    const orders: OrderView[] =
      orderResult.status === 'fulfilled' ? orderResult.value : []
    setBusinessSyncRows([
      ...suppliers.map(({ supplier, synchronization }) => ({
        key: `Supplier:${supplier.id}`,
        label: supplier.name,
        entityType: 'Supplier',
        synchronization,
      })),
      ...products.map(({ product, synchronization }) => ({
        key: `Product:${product.id}`,
        label: product.name,
        entityType: 'Product',
        synchronization,
      })),
      ...orders.map(({ order, synchronization }) => ({
        key: `Order:${order.id}`,
        label: `Order ${shortId(order.id)}`,
        entityType: 'Order',
        synchronization,
      })),
    ])
    if (supplierResult.status === 'rejected') {
      failures.push(`Supplier sync details: ${getErrorMessage(supplierResult.reason)}`)
    }
    if (productResult.status === 'rejected') {
      failures.push(`Product sync details: ${getErrorMessage(productResult.reason)}`)
    }
    if (orderResult.status === 'rejected') {
      failures.push(`Order sync details: ${getErrorMessage(orderResult.reason)}`)
    }

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

  async function handleSyncAll() {
    setBusyAction('sync')
    setNotice(null)
    try {
      const result = await api.syncAll()
      const synchronized = [...result.suppliers, ...result.products, ...result.orders]
      const failed = synchronized.filter(
        (sync) => sync.syncStatus === 'FAILED' || sync.retailTraceStatus === 'FAILED',
      ).length
      const pending = synchronized.filter(
        (sync) =>
          !sync.submissionUncertain &&
          (sync.syncStatus === 'PENDING' || sync.retailTraceStatus === 'PENDING'),
      ).length
      const uncertain = synchronized.filter((sync) => sync.submissionUncertain).length
      setNotice({
        kind: failed || pending || uncertain ? 'warning' : 'success',
        message: failed
          ? `${failed} records need attention${pending ? `; ${pending} are still pending synchronization or publication` : ''}${uncertain ? `; ${uncertain} have an unknown submission outcome` : ''}.`
          : pending || uncertain
            ? `${pending} records are pending synchronization or publication${uncertain ? `; ${uncertain} have an unknown submission outcome` : ''}.`
            : 'Suppliers, products, and orders are synced to RetailTrace.',
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

  async function handleSchemaDetail(schemaId: string) {
    setSchemaDetail(null)
    setCompatibility(null)
    try {
      setSchemaDetail(await api.getSchema(schemaId))
    } catch (error) {
      setNotice({ kind: 'error', message: getErrorMessage(error) })
    }
  }

  async function handleCompatibility(schemaId: string, entity: 'Supplier' | 'Product' | 'Order') {
    try {
      setCompatibility(await api.compareSchema(schemaId, entity))
    } catch (error) {
      setNotice({ kind: 'error', message: getErrorMessage(error) })
    }
  }

  async function handleSchemaUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    setSchemaUploadError('')
    setSchemaUploadSuccess('')
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        !('name' in parsed) ||
        typeof parsed.name !== 'string' ||
        !('fields' in parsed) ||
        !Array.isArray(parsed.fields)
      ) {
        throw new Error('Expected RetailTrace format: { "name": "...", "fields": [...] }')
      }
      const fields = parsed.fields as SchemaDetail['fields']
      const created = await api.uploadSchema({ name: parsed.name, fields })
      setSchemaUploadSuccess(`Schema "${created.name}" registered as version ${created.version}.`)
      await refresh()
    } catch (error) {
      setSchemaUploadError(
        error instanceof SyntaxError
          ? `Invalid JSON: ${error.message}`
          : getErrorMessage(error),
      )
    } finally {
      event.currentTarget.value = ''
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
                className="button button-secondary"
                onClick={() => void handleSyncAll()}
                disabled={busyAction !== null}
                title="Reconcile existing records and submit records that have not been synchronized"
              >
                {busyAction === 'sync' ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <RefreshCw size={17} />
                )}
                Sync and reconcile
              </button>
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
                <span>RetailTrace records</span>
                <span className="metric-icon metric-icon-neutral"><Database size={18} /></span>
              </div>
              <div className="metric-value">{loading && records.length === 0 ? '—' : records.length}</div>
              <div className="metric-foot">
                <span className="mini-dot green" />
                {status?.synchronization.failed ?? 0} sync failures · {status?.synchronization.pending ?? 0} pending syncs
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
              <div className="journey-step">
                <span className="journey-number">03</span>
                <span className="journey-icon"><FileStack size={19} /></span>
                <div><strong>Order</strong><small>One RetailTrace reference per item</small></div>
                <span className="step-state">{status?.schemas.orderSchemaId ? 'Registered' : 'Waiting'}</span>
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
              <label className="schema-upload">
                <ArrowDownToLine size={16} />
                <span>Upload RetailTrace .json</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => void handleSchemaUpload(event)}
                />
              </label>
              {schemaUploadError && <div className="notice notice-error" role="alert">{schemaUploadError}</div>}
              {schemaUploadSuccess && <div className="notice notice-success" role="status">{schemaUploadSuccess}</div>}
              <div className="schema-list">
                {schemas.length === 0 ? (
                  <div className="empty-state">
                    <FileStack size={21} />
                    <strong>No schemas loaded</strong>
                    <span>Initialize schemas or refresh the dashboard.</span>
                  </div>
                ) : (
                  schemas.map((schema) => (
                    <button
                      type="button"
                      className="schema-row"
                      key={schema.schemaId}
                      onClick={() => void handleSchemaDetail(schema.schemaId)}
                    >
                      <span className="schema-symbol"><FileStack size={17} /></span>
                      <div className="schema-details">
                        <strong>{schema.name}</strong>
                        <code title={schema.schemaId}>{shortId(schema.schemaId)}</code>
                      </div>
                      <span className="version-pill">v{schema.version}</span>
                    </button>
                  ))
                )}
              </div>
              <div className="panel-footnote">
                <span className="mini-dot green" />
                Schema IDs are stored in the local IntegrationConfig row.
              </div>
            </section>

            {schemaDetail && (
              <section className="panel retry-panel">
                <div className="panel-header">
                  <div>
                    <div className="eyebrow muted-eyebrow">SCHEMA DETAIL</div>
                    <h2>{schemaDetail.name} · v{schemaDetail.version}</h2>
                  </div>
                  <button className="text-button" onClick={() => setSchemaDetail(null)}>Close</button>
                </div>
                <code className="schema-detail-id">{schemaDetail.schemaId}</code>
                <div className="schema-field-list">
                  {schemaDetail.fields.map((field) => (
                    <div className="schema-field-row" key={field.name}>
                      <strong>{field.name}</strong>
                      <span>{field.type}{field.multiple ? '[]' : ''}</span>
                      <span>{field.required ? 'Required' : 'Optional'}</span>
                      {field.type === 'reference' && (
                        <code title={field.targetSchemaId}>Target: {field.targetSchemaId ? shortId(field.targetSchemaId) : 'missing'}</code>
                      )}
                    </div>
                  ))}
                </div>
                <div className="compatibility-actions">
                  {(['Supplier', 'Product', 'Order'] as const).map((entity) => (
                    <button
                      key={entity}
                      className="button button-secondary"
                      onClick={() => void handleCompatibility(schemaDetail.schemaId, entity)}
                    >
                      Compare {entity}
                    </button>
                  ))}
                </div>
                {compatibility && compatibility.schemaId === schemaDetail.schemaId && (
                  <div className="compatibility-report">
                    <strong>{compatibility.entity} compatibility: {compatibility.score}%</strong>
                    <small>{compatibility.compatibleFieldCount} of {compatibility.mappedFieldCount} mapped fields matched.</small>
                    {compatibility.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                    <div className="compatibility-table">
                      {compatibility.rows.map((row, index) => (
                        <div className="compatibility-row" key={`${row.databaseField}-${row.retailTraceField}-${index}`}>
                          <span>{row.databaseField || '—'} · {row.databaseType || '—'}</span>
                          <span>{row.retailTraceField || '—'} · {row.retailTraceType || '—'}</span>
                          <strong>{row.status}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            <section className="panel retry-panel">
              <div className="panel-header">
                <div>
                  <div className="eyebrow muted-eyebrow">RECOVERY</div>
                  <h2>Sync recovery</h2>
                </div>
                <span className="retry-icon"><RefreshCw size={18} /></span>
              </div>
              <p className="panel-description">
                Use “Sync and reconcile” to refresh stored mappings and retry eligible records.
                Existing RetailTrace record IDs are reused to avoid duplicate submissions.
              </p>
              <div className="retry-help">
                <CircleAlert size={15} />
                <span>No internal Sync ID is needed. Publication state, upstream IDs, timestamps, and errors are listed below.</span>
              </div>
            </section>
          </div>

          <section className="panel records-panel sync-details-panel">
            <div className="panel-header">
              <div>
                <div className="eyebrow muted-eyebrow">VERDANT MAPPINGS</div>
                <h2>Record synchronization</h2>
              </div>
              <span className="count-badge">{businessSyncRows.length} records</span>
            </div>
            <p className="panel-description">
              Local supplier, product, and order records with their RetailTrace publication state.
              A transaction ID is shown only when RetailTrace returned one.
            </p>
            <div className="records-table-wrap">
              <table className="records-table sync-table">
                <thead>
                  <tr>
                    <th>Verdant record</th>
                    <th>Publication status</th>
                    <th>RetailTrace record ID</th>
                    <th>Blockchain transaction ID</th>
                    <th>Last sync</th>
                    <th>Error details</th>
                  </tr>
                </thead>
                <tbody>
                  {businessSyncRows.map((row) => {
                    const sync = row.synchronization
                    const statusView = synchronizationLabel(sync)
                    return (
                      <tr key={row.key}>
                        <td>
                          <div className="record-name">{row.label}</div>
                          <span className="schema-name">{row.entityType}</span>
                        </td>
                        <td>
                          <span className={`sync-status sync-status-${statusView.tone}`}>
                            {statusView.label}
                          </span>
                        </td>
                        <td>
                          {sync?.retailTraceRecordId
                            ? <code className="record-id" title={sync.retailTraceRecordId}>{shortId(sync.retailTraceRecordId)}</code>
                            : <span className="record-id">Not available</span>}
                        </td>
                        <td>
                          {sync?.transactionId
                            ? <code className="record-id" title={sync.transactionId}>{shortId(sync.transactionId)}</code>
                            : <span className="record-id">Not available</span>}
                        </td>
                        <td className="record-date">
                          {sync ? formatDate(sync.updatedAt) : 'Not synced'}
                        </td>
                        <td className="sync-error" title={sync?.errorMessage ?? undefined}>
                          {sync?.errorMessage ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                  {businessSyncRows.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-table">
                          {loading
                            ? 'Loading Verdant synchronization details…'
                            : 'No local supplier, product, or order records are available.'}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

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
                    <th>Transaction ID</th>
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
                        <td>
                          {record.transactionId
                            ? <code className="record-id" title={record.transactionId}>{shortId(record.transactionId)}</code>
                            : <span className="record-id">Not available</span>}
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
                      <td colSpan={6}>
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

export default AdminDashboard
