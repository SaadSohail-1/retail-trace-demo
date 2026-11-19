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
  type SchemaField,
  type CompatibilityReport,
  type DatabaseModel,
  type SchemaMapping,
} from './services/api'
import { importSchemaDefinition } from './utils/schema-import'
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

type SchemaUploadPreview = {
  fileName: string
  name: string
  fields: SchemaField[]
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
  const [models, setModels] = useState<DatabaseModel[]>([])
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
  const [schemaUploadPreview, setSchemaUploadPreview] = useState<SchemaUploadPreview | null>(null)
  const [schemaUploading, setSchemaUploading] = useState(false)
  const [schemaCreationModel, setSchemaCreationModel] = useState('')
  const [schemaCreationName, setSchemaCreationName] = useState('')
  const [schemaCreationError, setSchemaCreationError] = useState('')
  const [schemaCreating, setSchemaCreating] = useState(false)
  const [schemaError, setSchemaError] = useState('')
  const [modelsError, setModelsError] = useState('')
  const [schemaDetailLoading, setSchemaDetailLoading] = useState(false)
  const [schemaDetailError, setSchemaDetailError] = useState('')
  const [mappingError, setMappingError] = useState('')
  const [comparisonError, setComparisonError] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({})
  const [comparisonSelection, setComparisonSelection] = useState('')
  const [mappingSaving, setMappingSaving] = useState(false)
  const [mappingConfigured, setMappingConfigured] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setRefreshError('')

    const results = await Promise.allSettled([
      api.getIntegrationStatus(),
      api.getHealth(),
      api.getSchemas(),
      api.getDatabaseModels(),
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
      modelsResult,
      recordResult,
      supplierResult,
      productResult,
      orderResult,
    ] = results
    if (statusResult.status === 'fulfilled') setStatus(statusResult.value)
    else failures.push(`Status: ${getErrorMessage(statusResult.reason)}`)

    if (healthResult.status === 'fulfilled') setHealth(healthResult.value)
    else failures.push(`RetailTrace health: ${getErrorMessage(healthResult.reason)}`)

    if (schemaResult.status === 'fulfilled') {
      setSchemas(schemaResult.value)
      setSchemaError('')
    } else {
      setSchemaError(getErrorMessage(schemaResult.reason))
      failures.push(`Schemas: ${getErrorMessage(schemaResult.reason)}`)
    }

    if (modelsResult.status === 'fulfilled') {
      setModels(modelsResult.value)
      setModelsError('')
    } else {
      setModelsError(getErrorMessage(modelsResult.reason))
      failures.push(`Prisma models: ${getErrorMessage(modelsResult.reason)}`)
    }

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
    setMappingConfigured(false)
    setCompatibility(null)
    setComparisonSelection('')
    setSchemaDetailError('')
    setMappingError('')
    setComparisonError('')
    setSchemaDetailLoading(true)
    try {
      const [detail, savedMapping] = await Promise.all([
        api.getSchema(schemaId),
        api.getSchemaMapping(schemaId),
      ])
      setSchemaDetail(detail)
      setMappingConfigured(savedMapping !== null)
      const exactModel = models.find(
        (model) => model.entity.toLowerCase() === detail.name.toLowerCase(),
      )
      const initialModel = savedMapping?.modelName ?? exactModel?.entity ?? ''
      setSelectedModel(initialModel)
      if (savedMapping) {
        setFieldMappings(savedMapping.fieldMappings)
      } else {
        const model = models.find((candidate) => candidate.entity === initialModel)
        const sameNameMappings = Object.fromEntries(
          (model?.fields ?? [])
            .filter((field) => detail.fields.some((candidate) => candidate.name === field.name))
            .map((field) => [field.name, field.name]),
        )
        setFieldMappings(sameNameMappings)
      }
    } catch (error) {
      setSchemaDetailError(getErrorMessage(error))
    } finally {
      setSchemaDetailLoading(false)
    }
  }

  function createDefinitionFromModel(model: DatabaseModel) {
    const omitted: string[] = []
    const fields = model.fields.flatMap((field): SchemaField[] => {
      const rawType = field.databaseType.replace(/\[\]$/, '')
      const arrayType = field.databaseType.endsWith('[]')
      if (arrayType) {
        omitted.push(`${field.name} (${field.databaseType}: scalar arrays are not supported)`)
        return []
      }
      if (field.reference) {
        const target = schemas
          .filter((schema) => schema.name.toLowerCase() === field.reference!.targetEntity.toLowerCase())
          .sort((a, b) => b.version - a.version)[0]
        if (!target) {
          omitted.push(`${field.name} (reference to ${field.reference.targetEntity}: register that target schema first)`)
          return []
        }
        return [{ name: field.name, type: 'reference' as const, targetSchemaId: target.schemaId, required: field.required }]
      }
      if (rawType === 'String' || rawType.startsWith('Enum(')) {
        return [{ name: field.name, type: 'string' as const, required: field.required }]
      }
      if (rawType === 'Int' || rawType === 'BigInt') {
        return [{ name: field.name, type: 'integer' as const, required: field.required }]
      }
      if (rawType === 'Float' || rawType === 'Decimal') {
        return [{ name: field.name, type: 'number' as const, required: field.required }]
      }
      if (rawType === 'Boolean') {
        return [{ name: field.name, type: 'boolean' as const, required: field.required }]
      }
      if (rawType === 'DateTime' || rawType === 'Date') {
        return [{ name: field.name, type: 'date' as const, required: field.required }]
      }
      omitted.push(`${field.name} (${field.databaseType}: no supported RetailTrace field type)`)
      return []
    })
    return { fields, omitted }
  }

  async function handleCreateSchemaFromModel() {
    const model = models.find((candidate) => candidate.entity === schemaCreationModel)
    if (!model) return
    setSchemaCreationError('')
    setSchemaCreating(true)
    try {
      const definition = createDefinitionFromModel(model)
      const missingReferenceTargets = definition.omitted.filter((item) => item.includes('reference to'))
      if (missingReferenceTargets.length > 0) {
        throw new Error(`Register the referenced RetailTrace schema(s) before creating this schema: ${missingReferenceTargets.join('; ')}`)
      }
      if (definition.fields.length === 0) {
        throw new Error('No supported fields are available. Check the model field types and reference target schemas.')
      }
      const created = await api.uploadSchema({ name: schemaCreationName.trim() || model.entity, fields: definition.fields })
      setSchemas(await api.getSchemas())
      setSchemaCreationName('')
      const omissions = definition.omitted.length > 0 ? ` Excluded: ${definition.omitted.join('; ')}.` : ''
      setSchemaUploadSuccess(`Created ${created.name} v${created.version} from Prisma model ${model.entity}.${omissions}`)
      setSchemaCreationModel('')
    } catch (error) {
      setSchemaCreationError(getErrorMessage(error))
    } finally {
      setSchemaCreating(false)
    }
  }

  function handleModelChange(modelName: string) {
    setSelectedModel(modelName)
    setMappingConfigured(false)
    setCompatibility(null)
    setComparisonSelection('')
    setComparisonError('')
    const model = models.find((candidate) => candidate.entity === modelName)
    const sameNameMappings = Object.fromEntries(
      (model?.fields ?? [])
        .filter((field) => schemaDetail?.fields.some((candidate) => candidate.name === field.name))
        .map((field) => [field.name, field.name]),
    )
    setFieldMappings(sameNameMappings)
  }

  function updateFieldMapping(databaseField: string, retailTraceField: string) {
    setMappingConfigured(false)
    setFieldMappings((current) => {
      const next = { ...current }
      if (retailTraceField) next[databaseField] = retailTraceField
      else delete next[databaseField]
      return next
    })
    setCompatibility(null)
    setComparisonSelection('')
  }

  function getCurrentMapping(): SchemaMapping {
    return { modelName: selectedModel, fieldMappings }
  }

  function getComparisonSelection(schemaId: string): string {
    return JSON.stringify({ schemaId, ...getCurrentMapping() })
  }

  async function handleCompatibility() {
    if (!schemaDetail || !selectedModel) return
    setCompatibility(null)
    setComparisonSelection('')
    setComparisonError('')
    try {
      const mapping = getCurrentMapping()
      const report = await api.compareSchema(schemaDetail.schemaId, mapping)
      setCompatibility(report)
      setComparisonSelection(getComparisonSelection(schemaDetail.schemaId))
    } catch (error) {
      setComparisonError(getErrorMessage(error))
    }
  }

  async function handleSaveMapping() {
    if (!schemaDetail || !compatibility || !selectedModel) return
    setMappingSaving(true)
    setMappingError('')
    try {
      const mapping = getCurrentMapping()
      await api.saveSchemaMapping(schemaDetail.schemaId, mapping)
      setMappingConfigured(true)
      const report = await api.compareSchema(schemaDetail.schemaId, mapping)
      setCompatibility(report)
      setComparisonSelection(getComparisonSelection(schemaDetail.schemaId))
    } catch (error) {
      setMappingError(getErrorMessage(error))
    } finally {
      setMappingSaving(false)
    }
  }

  async function handleSchemaUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    if (!file) return
    setSchemaUploadError('')
    setSchemaUploadSuccess('')
    setSchemaUploadPreview(null)
    try {
      const imported = importSchemaDefinition(JSON.parse(await file.text()) as unknown)
      setSchemaUploadPreview({ fileName: file.name, name: imported.name, fields: imported.fields })
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

  async function handleRegisterUploadedSchema() {
    if (!schemaUploadPreview) return
    const name = schemaUploadPreview.name.trim()
    if (!name) {
      setSchemaUploadError('Enter a schema name before registering this JSON Schema.')
      return
    }
    setSchemaUploading(true)
    setSchemaUploadError('')
    try {
      const created = await api.uploadSchema({ name, fields: schemaUploadPreview.fields })
      setSchemaUploadPreview(null)
      setSchemaUploadSuccess(`Schema “${created.name}” registered as version ${created.version}.`)
      await refresh()
    } catch (error) {
      setSchemaUploadError(getErrorMessage(error))
    } finally {
      setSchemaUploading(false)
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
              {schemaUploadPreview && (
                <div className="schema-import-preview">
                  <div className="schema-import-heading">
                    <div>
                      <div className="eyebrow muted-eyebrow">REVIEW BEFORE REGISTERING</div>
                      <strong>{schemaUploadPreview.fileName}</strong>
                    </div>
                    <button className="text-button" type="button" onClick={() => { setSchemaUploadPreview(null); setSchemaUploadError('') }}>Cancel</button>
                  </div>
                  <p>RetailTrace will validate records against these converted fields after registration.</p>
                  <label className="schema-import-name">
                    Schema name
                    <input
                      value={schemaUploadPreview.name}
                      onChange={(event) => setSchemaUploadPreview((current) => current ? { ...current, name: event.target.value } : current)}
                      placeholder="Enter a name for this schema"
                    />
                  </label>
                  <div className="schema-import-fields">
                    {schemaUploadPreview.fields.map((field) => (
                      <div className="schema-import-field" key={field.name}>
                        <strong>{field.name}</strong>
                        <span>{field.type}{field.type === 'reference' && field.multiple ? '[]' : ''}</span>
                        <span className="schema-import-required">{field.required ? 'Required' : 'Optional'}</span>
                        {field.type === 'reference' && <small>Target schema: {field.targetSchemaId}</small>}
                        {field.description && <small>{field.description}</small>}
                        {field.constraints && <code>{JSON.stringify(field.constraints)}</code>}
                      </div>
                    ))}
                  </div>
                  <div className="schema-import-actions">
                    <button className="button button-primary" type="button" disabled={schemaUploading} onClick={() => void handleRegisterUploadedSchema()}>
                      {schemaUploading ? <LoaderCircle size={16} className="spin" /> : <FileStack size={16} />}
                      {schemaUploading ? 'Registering…' : 'Register schema'}
                    </button>
                    <span>Registration creates a new schema version; it does not replace existing versions.</span>
                  </div>
                </div>
              )}
              {schemaUploadError && <div className="notice notice-error" role="alert">{schemaUploadError}</div>}
              <div className="schema-model-creator">
                <div className="eyebrow muted-eyebrow">CREATE FROM YOUR DATABASE</div>
                <p className="panel-description">
                  Build a RetailTrace definition from a Prisma model. Foreign keys become references when their target schema exists.
                </p>
                {modelsError ? (
                  <p className="notice notice-error" role="alert">Could not read Prisma models: {modelsError}</p>
                ) : (
                  <>
                    <div className="schema-creator-controls">
                      <label>
                        Prisma model
                        <select value={schemaCreationModel} onChange={(event) => { setSchemaCreationModel(event.target.value); setSchemaCreationError('') }}>
                          <option value="">Choose a model…</option>
                          {models.map((model) => <option key={model.entity} value={model.entity}>{model.entity}</option>)}
                        </select>
                      </label>
                      <label>
                        RetailTrace schema name
                        <input value={schemaCreationName} onChange={(event) => setSchemaCreationName(event.target.value)} placeholder={schemaCreationModel || 'Uses model name'} />
                      </label>
                    </div>
                    {schemaCreationModel && (() => {
                      const model = models.find((candidate) => candidate.entity === schemaCreationModel)
                      if (!model) return null
                      const preview = createDefinitionFromModel(model)
                      const hasMissingReferenceTargets = preview.omitted.some((item) => item.includes('reference to'))
                      return (
                        <div className="schema-model-preview">
                          <strong>Preview · {preview.fields.length} fields from {model.entity}</strong>
                          <div className="schema-model-preview-fields">
                            {preview.fields.map((field) => (
                              <span key={field.name}><b>{field.name}</b> · {field.type}{field.type === 'reference' ? ` → ${schemas.find((item) => item.schemaId === field.targetSchemaId)?.name ?? 'target schema'}` : ''}{field.required ? ' · required' : ' · optional'}</span>
                            ))}
                          </div>
                          {preview.omitted.length > 0 && <p className="schema-model-omissions">Not represented: {preview.omitted.join('; ')}</p>}
                          <button className="button button-primary" disabled={schemaCreating || preview.fields.length === 0 || hasMissingReferenceTargets} onClick={() => void handleCreateSchemaFromModel()}>
                            {schemaCreating ? <LoaderCircle size={16} className="spin" /> : <FileStack size={16} />}
                            Create from {model.entity}
                          </button>
                        </div>
                      )
                    })()}
                    {schemaCreationError && <p className="notice notice-error" role="alert">{schemaCreationError}</p>}
                  </>
                )}
              </div>
              {schemaUploadSuccess && <div className="notice notice-success" role="status">{schemaUploadSuccess}</div>}
              <div className="schema-list">
                {loading && schemas.length === 0 ? (
                  <div className="empty-state" role="status">
                    <LoaderCircle size={20} className="spin" />
                    <strong>Loading RetailTrace schemas</strong>
                    <span>Fetching the registered schemas for Verdant’s configured RetailTrace account.</span>
                  </div>
                ) : schemaError ? (
                  <div className="empty-state" role="alert">
                    <CircleAlert size={20} />
                    <strong>Could not load schemas</strong>
                    <span>{schemaError}</span>
                    <button className="text-button" onClick={() => void refresh()}>Try again</button>
                  </div>
                ) : schemas.length === 0 ? (
                  <div className="empty-state">
                    <FileStack size={21} />
                    <strong>No registered schemas</strong>
                    <span>The configured RetailTrace business currently has no schemas.</span>
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
                Schemas are fetched from RetailTrace using Verdant’s server-side business API key.
              </div>
            </section>

            {schemaDetailLoading && (
              <section className="panel retry-panel" role="status">
                <LoaderCircle size={20} className="spin" /> Loading selected schema details…
              </section>
            )}
            {schemaDetailError && (
              <section className="panel retry-panel" role="alert">
                <div className="notice notice-error">
                  <CircleAlert size={18} />
                  <span>{schemaDetailError}</span>
                </div>
              </section>
            )}
            {schemaDetail && (
              <div className="schema-dialog-backdrop" tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') setSchemaDetail(null) }} onMouseDown={(event) => { if (event.target === event.currentTarget) setSchemaDetail(null) }}>
              <section className="schema-dialog" role="dialog" aria-modal="true" aria-labelledby="schema-dialog-title">
                <div className="panel-header">
                  <div>
                    <div className="eyebrow muted-eyebrow">RETAILTRACE SCHEMA</div>
                    <h2 id="schema-dialog-title">{schemaDetail.name} <span>Version {schemaDetail.version}</span></h2>
                  </div>
                  <button className="schema-dialog-close" onClick={() => setSchemaDetail(null)} aria-label="Close schema details">Close</button>
                </div>
                <p className="schema-dialog-description">RetailTrace validates these {schemaDetail.fields.length} fields when Verdant publishes records using this schema.</p>
                <code className="schema-detail-id">Schema ID · {schemaDetail.schemaId}</code>
                <div className="schema-field-list" aria-label="RetailTrace schema fields">
                  {schemaDetail.fields.map((field) => (
                    <div className="schema-field-row" key={field.name}>
                      <strong>{field.name}</strong>
                      <span className="schema-type-pill">{field.type}{field.multiple ? '[]' : ''}</span>
                      <span className={`required-pill ${field.required ? 'is-required' : ''}`}>{field.required ? 'Required' : 'Optional'}</span>
                      {field.type === 'reference' && (
                        <code title={field.targetSchemaId}>References schema {field.targetSchemaId ? shortId(field.targetSchemaId) : 'not configured'}</code>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mapping-editor">
                  <div className="mapping-section-heading">
                    <div>
                      <div className="eyebrow muted-eyebrow">DATABASE COMPARISON</div>
                      <h3>Compare with Verdant’s database</h3>
                    </div>
                    <span className={`mapping-state ${compatibility?.configurationSaved ? 'is-saved' : ''}`}>
                      {compatibility ? compatibility.configurationSaved ? 'Mapping saved' : 'Preview · not saved' : mappingConfigured ? 'Saved · not rechecked' : 'Not compared'}
                    </span>
                  </div>
                  <p className="mapping-explainer">Choose the Prisma model this RetailTrace schema represents, review the field matches, then save the association if it’s correct. Comparing and saving a mapping do not change either schema or any records.</p>
                  {modelsError ? (
                    <p className="notice notice-error" role="alert">Could not load Prisma models: {modelsError}</p>
                  ) : (
                    <>
                      <label className="mapping-model-picker">
                        Business database model
                        <select
                          value={selectedModel}
                          onChange={(event) => handleModelChange(event.target.value)}
                        >
                          <option value="">Choose a Prisma model…</option>
                          {models.map((model) => (
                            <option key={model.entity} value={model.entity}>{model.entity}</option>
                          ))}
                        </select>
                      </label>
                      {!selectedModel && (
                        <p className="mapping-unconfigured">No model selected yet. Choose the business table this schema should be compared with.</p>
                      )}
                      {selectedModel && models.find((model) => model.entity === selectedModel) && (
                        <div className="mapping-fields">
                          {(models.find((model) => model.entity === selectedModel)?.fields ?? []).map((field) => (
                            <label className="mapping-field-row" key={field.name}>
                              <span>
                                <strong>{field.name}</strong>
                                <small>{field.databaseType}{field.required ? ' · required' : ' · optional'}{field.reference ? ` · relation to ${field.reference.targetEntity}` : ''}</small>
                              </span>
                              <select
                                aria-label={`Map Prisma ${field.name} to RetailTrace field`}
                                value={fieldMappings[field.name] ?? ''}
                                onChange={(event) => updateFieldMapping(field.name, event.target.value)}
                              >
                                <option value="">Not mapped</option>
                                {schemaDetail.fields.map((schemaField) => (
                                  <option key={schemaField.name} value={schemaField.name}>
                                    {schemaField.name} ({schemaField.type}{schemaField.multiple ? '[]' : ''})
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                      )}
                      <div className="compatibility-actions">
                        <button
                          className="button button-secondary"
                          disabled={!selectedModel}
                          onClick={() => void handleCompatibility()}
                        >
                          Compare fields
                        </button>
                        <span className="mapping-status">A comparison is a read-only preview.</span>
                      </div>
                    </>
                  )}
                  {comparisonError && <p className="notice notice-error" role="alert">{comparisonError}</p>}
                  {mappingError && <p className="notice notice-error" role="alert">{mappingError}</p>}
                </div>
                {compatibility && compatibility.schemaId === schemaDetail.schemaId && (
                  <div className="compatibility-report">
                    <div className="compatibility-score-card">
                      <span className="compatibility-score">{compatibility.score}<small>%</small></span>
                      <div>
                        <strong>{compatibility.compatibleFieldCount} of {compatibility.mappedFieldCount} database fields are compatible</strong>
                        <p>The percentage is the share of Prisma scalar fields that match by name or explicit mapping, type, required status, and reference target.</p>
                        <span className={`mapping-state ${compatibility.configurationSaved ? 'is-saved' : ''}`}>{compatibility.configurationSaved ? 'Saved association' : 'Preview only · not saved'}</span>
                      </div>
                    </div>
                    {!compatibility.configurationSaved && <p className="mapping-save-explainer">Save records which database model and field names correspond to this RetailTrace schema. It does not edit either schema.</p>}
                    {compatibility.warnings.filter((warning) => !warning.startsWith('This is an unsaved mapping preview') && !warning.startsWith('The score covers matched Prisma scalar fields only')).map((warning) => <p className="compatibility-warning" key={warning}>{warning}</p>)}
                    <div className="compatibility-table">
                      <div className="compatibility-table-head"><span>Prisma field</span><span>RetailTrace field</span><span>Result</span></div>
                      {compatibility.rows.map((row, index) => (
                        <div className="compatibility-row" key={`${row.databaseField}-${row.retailTraceField}-${index}`}>
                          <span><strong>{row.databaseField || '—'}</strong><small>{row.databaseType || 'Not mapped'}</small></span>
                          <span><strong>{row.retailTraceField || '—'}</strong><small>{row.retailTraceType || 'Not mapped'}</small></span>
                          <span className="compatibility-result"><strong>{row.status}</strong><small>{row.detail}</small></span>
                        </div>
                      ))}
                    </div>
                    {comparisonSelection === getComparisonSelection(schemaDetail.schemaId) && (
                      <button
                        className="button button-primary"
                        disabled={mappingSaving || compatibility.configurationSaved}
                        onClick={() => void handleSaveMapping()}
                      >
                        {mappingSaving ? 'Saving association…' : compatibility.configurationSaved ? 'Association saved' : 'Save model association'}
                      </button>
                    )}
                  </div>
                )}
              </section>
              </div>
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
