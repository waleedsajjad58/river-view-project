import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, X, Search, User, Home, FileText, Check, Trash2, Edit2 } from 'lucide-react'

const ipc = (window as any).ipcRenderer
const fmt = (n: number) => `Rs. ${(n || 0).toLocaleString()}`

// ── Status badge ──────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { label: string, cls: string }> = {
        paid: { label: 'Paid', cls: 'badge-paid' },
        partial: { label: 'Partial', cls: 'badge-partial' },
        overdue: { label: 'Overdue', cls: 'badge-overdue' },
        unpaid: { label: 'Unpaid', cls: 'badge-unpaid' },
    }
    const s = map[status] || { label: status, cls: 'badge-gray' }
    return <span className={`badge ${s.cls}`}>{s.label}</span>
}

// ── Tenant form ───────────────────────────────────────────────
function TenantForm({ form, onChange, plots }: { form: any, onChange: (f: any) => void, plots: any[] }) {
    const set = (k: string, v: any) => onChange({ ...form, [k]: v })
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-grid">
                <div className="form-group">
                    <label>Full Name *</label>
                    <input type="text" value={form.name}
                        onChange={e => set('name', e.target.value)}
                        placeholder="e.g. Muhammad Ali Khan"
                        autoFocus
                    />
                </div>
                <div className="form-group">
                    <label>Tenant ID *</label>
                    <input type="text" value={form.tenant_id || ''}
                        onChange={e => set('tenant_id', e.target.value)}
                        placeholder="e.g. TEN-00001"
                        style={{ fontFamily: 'IBM Plex Mono', letterSpacing: '0.02em' }}
                    />
                </div>
            </div>
            <div className="form-grid">
                <div className="form-group">
                    <label>CNIC *</label>
                    <input type="text" value={form.cnic}
                        onChange={e => set('cnic', e.target.value)}
                        placeholder="35201-1234567-1"
                        style={{ fontFamily: 'IBM Plex Mono', letterSpacing: '0.02em' }}
                    />
                </div>
                <div className="form-group">
                    <label>Phone *</label>
                    <input type="text" value={form.phone}
                        onChange={e => set('phone', e.target.value)}
                        placeholder="0300-1234567"
                        style={{ fontFamily: 'IBM Plex Mono' }}
                    />
                </div>
                <div className="form-group">
                    <label>Plot *</label>
                    <select value={form.plot_id} onChange={e => set('plot_id', parseInt(e.target.value) || 0)}>
                        <option value={0}>— Select a plot —</option>
                        {plots.map(p => (
                            <option key={p.id} value={p.id}>
                                Plot {p.plot_number}{p.block ? ` (${p.block})` : ''} · {p.marla_size}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="form-grid">
                <div className="form-group">
                    <label>Start Date *</label>
                    <input type="date" value={form.start_date}
                        onChange={e => set('start_date', e.target.value)} />
                </div>
                <div className="form-group">
                    <label>End Date</label>
                    <input type="date" value={form.end_date}
                        onChange={e => set('end_date', e.target.value)} />
                </div>
            </div>
            <div className="form-group">
                <label>Monthly Rent (Rs.)</label>
                <input type="number" min="0" value={form.monthly_rent}
                    onChange={e => set('monthly_rent', parseFloat(e.target.value) || 0)}
                    style={{ fontFamily: 'IBM Plex Mono' }}
                />
            </div>
            <div className="form-group">
                <label>Notes</label>
                <textarea value={form.notes}
                    onChange={e => set('notes', e.target.value)}
                    placeholder="Any additional notes..."
                    rows={2}
                />
            </div>
        </div>
    )
}

// ── Tenant statement view ─────────────────────────────────────
function TenantStatement({ tenantId }: { tenantId: number }) {
    const [data, setData] = useState<any>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!ipc || !tenantId) return
        setLoading(true)
        ipc.invoke('db:get-tenant-statement', tenantId)
            .then((d: any) => setData(d))
            .catch(console.error)
            .finally(() => setLoading(false))
    }, [tenantId])

    if (loading) return (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--t-faint)', fontSize: 13 }}>
            Loading statement...
        </div>
    )
    if (!data) return null

    const { summary, bills } = data

    return (
        <div>
            {/* Summary strip */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4,1fr)',
                gap: 1, background: 'var(--border)',
                border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                overflow: 'hidden', marginBottom: 16,
                boxShadow: 'var(--shadow-card)'
            }}>
                {[
                    { label: 'Total Billed', value: fmt(summary.totalBilled), color: 'var(--t-primary)' },
                    { label: 'Total Paid', value: fmt(summary.totalPaid), color: 'var(--c-paid)' },
                    { label: 'Outstanding', value: fmt(summary.totalOutstanding), color: 'var(--c-overdue)' },
                    { label: 'Unpaid Bills', value: summary.unpaidCount, color: summary.unpaidCount > 0 ? 'var(--c-overdue)' : 'var(--t-primary)' },
                ].map(s => (
                    <div key={s.label} style={{ background: 'var(--bg)', padding: '14px 16px' }}>
                        <div style={{
                            fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: '0.07em', color: 'var(--t-faint)',
                            fontFamily: 'IBM Plex Mono', marginBottom: 6
                        }}>
                            {s.label}
                        </div>
                        <div style={{
                            fontSize: 16, fontWeight: 700, fontFamily: 'IBM Plex Mono',
                            color: s.color, letterSpacing: '-0.02em'
                        }}>
                            {s.value}
                        </div>
                    </div>
                ))}
            </div>

            {/* Bills table */}
            <div style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--t-faint)',
                fontFamily: 'IBM Plex Mono', marginBottom: 8
            }}>
                Bill History
            </div>
            <div className="table-wrap">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Bill #</th>
                            <th>Plot</th>
                            <th>Month</th>
                            <th>Date</th>
                            <th style={{ textAlign: 'right' }}>Total</th>
                            <th style={{ textAlign: 'right' }}>Paid</th>
                            <th style={{ textAlign: 'right' }}>Balance</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {bills.length === 0 ? (
                            <tr>
                                <td colSpan={8} style={{
                                    textAlign: 'center', padding: 32,
                                    color: 'var(--t-faint)', fontSize: 13
                                }}>
                                    No bills found for this tenant.
                                </td>
                            </tr>
                        ) : bills.map((b: any) => (
                            <tr key={b.id}>
                                <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 11.5, color: 'var(--t-faint)' }}>
                                    {b.bill_number}
                                </td>
                                <td style={{ fontWeight: 600, fontFamily: 'IBM Plex Mono', fontSize: 12 }}>
                                    {b.plot_number}
                                </td>
                                <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--t-muted)' }}>
                                    {b.billing_month || '—'}
                                </td>
                                <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 11.5, color: 'var(--t-faint)' }}>
                                    {b.bill_date}
                                </td>
                                <td className="td-mono">{(b.total_amount || 0).toLocaleString()}</td>
                                <td className="td-mono" style={{ color: 'var(--c-paid)' }}>
                                    {(b.amount_paid || 0).toLocaleString()}
                                </td>
                                <td className="td-mono" style={{ color: b.balance_due > 0 ? 'var(--c-overdue)' : 'var(--t-faint)' }}>
                                    {(b.balance_due || 0).toLocaleString()}
                                </td>
                                <td><StatusBadge status={b.status} /></td>
                            </tr>
                        ))}
                    </tbody>
                    {bills.length > 0 && (
                        <tfoot>
                            <tr>
                                <td colSpan={4} style={{
                                    padding: '8px 16px', fontSize: 11.5,
                                    color: 'var(--t-faint)', fontFamily: 'IBM Plex Mono',
                                    background: 'var(--bg-subtle)', borderTop: '1px solid var(--border-strong)'
                                }}>
                                    {bills.length} bills
                                </td>
                                <td style={{
                                    padding: '8px 16px', fontFamily: 'IBM Plex Mono',
                                    fontWeight: 700, fontSize: 12.5, textAlign: 'right',
                                    background: 'var(--bg-subtle)', borderTop: '1px solid var(--border-strong)'
                                }}>
                                    {summary.totalBilled.toLocaleString()}
                                </td>
                                <td style={{
                                    padding: '8px 16px', fontFamily: 'IBM Plex Mono',
                                    fontWeight: 700, fontSize: 12.5, textAlign: 'right',
                                    color: 'var(--c-paid)',
                                    background: 'var(--bg-subtle)', borderTop: '1px solid var(--border-strong)'
                                }}>
                                    {summary.totalPaid.toLocaleString()}
                                </td>
                                <td style={{
                                    padding: '8px 16px', fontFamily: 'IBM Plex Mono',
                                    fontWeight: 700, fontSize: 12.5, textAlign: 'right',
                                    color: 'var(--c-overdue)',
                                    background: 'var(--bg-subtle)', borderTop: '1px solid var(--border-strong)'
                                }}>
                                    {summary.totalOutstanding.toLocaleString()}
                                </td>
                                <td style={{ background: 'var(--bg-subtle)', borderTop: '1px solid var(--border-strong)' }} />
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    )
}

// ── Read-only tenant info block ───────────────────────────────
function TenantInfo({ tenant }: { tenant: any }) {
    const row = (label: string, value: string | number | null, mono = false) => (
        <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '9px 0', borderBottom: '1px solid var(--border)'
        }}>
            <span style={{
                fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--t-faint)',
                fontFamily: 'IBM Plex Mono'
            }}>
                {label}
            </span>
            <span style={{
                fontSize: 13, color: value ? 'var(--t-secondary)' : 'var(--t-faint)',
                fontFamily: mono ? 'IBM Plex Mono' : undefined,
                fontStyle: value ? 'normal' : 'italic'
            }}>
                {value || '—'}
            </span>
        </div>
    )

    const isActive = !tenant.end_date || tenant.end_date === '' || new Date(tenant.end_date) >= new Date()

    return (
        <div>
            {row('Full Name', tenant.name)}
            {row('Tenant ID', tenant.tenant_id, true)}
            {row('CNIC', tenant.cnic, true)}
            {row('Phone', tenant.phone, true)}
            {row('Plot', tenant.plot_number ? `Plot ${tenant.plot_number}` : null)}
            {row('Start Date', tenant.start_date)}
            {row('End Date', tenant.end_date)}
            {row('Monthly Rent', tenant.monthly_rent ? fmt(tenant.monthly_rent) : null, true)}
            {row('Status', isActive ? 'Active Tenant' : 'Ended')}
            {tenant.owner_name && row('Plot Owner', tenant.owner_name)}
            {tenant.notes && row('Notes', tenant.notes)}
        </div>
    )
}

// ── Tenant detail / edit panel ────────────────────────────────
type PanelTab = 'overview' | 'statement'
type PanelMode = 'view' | 'edit'

function TenantPanel({ tenant, onClose, onSaved, onDeleted }: {
    tenant: any, onClose: () => void,
    onSaved: () => void, onDeleted: () => void
}) {
    const [tab, setTab] = useState<PanelTab>('overview')
    const [mode, setMode] = useState<PanelMode>('view')
    const [form, setForm] = useState({ ...tenant })
    const [saving, setSaving] = useState(false)
    const [confirm, setConfirm] = useState(false)
    const [plots, setPlots] = useState<any[]>([])

    useEffect(() => {
        setForm({ ...tenant })
        setTab('overview')
        setMode('view')
        setConfirm(false)
        if (ipc) {
            ipc.invoke('db:get-plots').then((p: any[]) => setPlots(p || [])).catch(() => setPlots([]))
        }
    }, [tenant.id])

    const handleSave = async () => {
        if (!String(form.tenant_id || '').trim() || !form.name.trim() || !String(form.cnic || '').trim() || !String(form.phone || '').trim() || !String(form.start_date || '').trim() || !form.plot_id) return
        setSaving(true)
        try {
            await ipc.invoke('db:update-tenant', { ...form, id: tenant.id })
            onSaved()
        } finally { setSaving(false) }
    }

    const handleDelete = async () => {
        await ipc.invoke('db:remove-tenant', tenant.id)
        onDeleted()
    }

    const cancelEdit = () => {
        setForm({ ...tenant })
        setMode('view')
        setConfirm(false)
    }

    const isActive = !tenant.end_date || tenant.end_date === '' || new Date(tenant.end_date) >= new Date()

    return (
        <div className="panel-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="panel" style={{ width: 760 }}>
                {/* ── Header ── */}
                <div className="panel-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: 'var(--accent-light)', border: '1px solid var(--accent-border)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            <User size={15} style={{ color: 'var(--accent)' }} />
                        </div>
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-primary)', letterSpacing: '-0.01em' }}>
                                {tenant.name}
                            </div>
                            {(tenant.tenant_id || tenant.plot_number) && (
                                <div style={{ fontSize: 11, color: 'var(--t-faint)', fontFamily: 'IBM Plex Mono' }}>
                                    {(tenant.tenant_id || '').trim() || `Plot ${tenant.plot_number}`}
                                </div>
                            )}
                        </div>
                        <span className={`badge ${isActive ? 'badge-paid' : 'badge-gray'}`} style={{ marginLeft: 4 }}>
                            {isActive ? 'Active' : 'Ended'}
                        </span>
                    </div>
                    <button className="panel-close" onClick={onClose}><X size={16} /></button>
                </div>

                {/* ── Tabs ── */}
                <div className="tabs" style={{ padding: '0 20px', marginBottom: 0 }}>
                    <button className={`tab-btn ${tab === 'overview' ? 'active' : ''}`}
                        onClick={() => { setTab('overview'); if (mode === 'edit') cancelEdit() }}>
                        <User size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                        Overview
                    </button>
                    <button className={`tab-btn ${tab === 'statement' ? 'active' : ''}`}
                        onClick={() => { setTab('statement'); if (mode === 'edit') cancelEdit() }}>
                        <FileText size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                        Statement
                    </button>
                </div>

                {/* ── Body ── */}
                <div className="panel-body">
                    {tab === 'overview' && mode === 'view' && (
                        <TenantInfo tenant={tenant} />
                    )}
                    {tab === 'overview' && mode === 'edit' && (
                        <TenantForm form={form} onChange={setForm} plots={plots} />
                    )}
                    {tab === 'statement' && (
                        <TenantStatement tenantId={tenant.id} />
                    )}
                </div>

                {/* ── Footer ── */}
                <div className="panel-footer" style={{ justifyContent: 'space-between' }}>
                    <div>
                        {mode === 'view' && tab === 'overview' && (
                            confirm ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontSize: 12.5, color: 'var(--c-overdue)' }}>
                                        Delete permanently?
                                    </span>
                                    <button className="btn btn-danger btn-sm" onClick={handleDelete}>
                                        Yes, delete
                                    </button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <button className="btn btn-ghost btn-sm"
                                    style={{ color: 'var(--c-overdue)', borderColor: 'var(--c-overdue-border)' }}
                                    onClick={() => setConfirm(true)}>
                                    <Trash2 size={13} /> Delete
                                </button>
                            )
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {mode === 'view' ? (
                            <>
                                <button className="btn btn-ghost" onClick={onClose}>Close</button>
                                {tab === 'overview' && (
                                    <button className="btn btn-primary" onClick={() => setMode('edit')}>
                                        <Edit2 size={13} /> Edit Tenant
                                    </button>
                                )}
                            </>
                        ) : (
                            <>
                                <button className="btn btn-ghost" onClick={cancelEdit}>Cancel</button>
                                <button className="btn btn-primary" onClick={handleSave}
                                    disabled={saving || !String(form.tenant_id || '').trim() || !form.name.trim() || !String(form.cnic || '').trim() || !String(form.phone || '').trim() || !String(form.start_date || '').trim() || !form.plot_id}>
                                    <Check size={14} />
                                    {saving ? 'Saving...' : 'Save Changes'}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── Add tenant panel ──────────────────────────────────────────
function AddTenantPanel({ onClose, onSaved }: { onClose: () => void, onSaved: () => void }) {
    const [form, setForm] = useState({
        tenant_id: '', name: '', cnic: '', phone: '', plot_id: 0,
        start_date: new Date().toISOString().split('T')[0], end_date: '', monthly_rent: 2500, notes: ''
    })
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState('')
    const [plots, setPlots] = useState<any[]>([])

    useEffect(() => {
        if (ipc) ipc.invoke('db:get-plots').then((p: any[]) => setPlots(p || [])).catch(() => setPlots([]))
    }, [])

    const handleSave = async () => {
        if (!form.tenant_id.trim()) { setErr('Tenant ID is required'); return }
        if (!form.name.trim()) { setErr('Name is required'); return }
        if (!form.cnic.trim()) { setErr('CNIC is required'); return }
        if (!form.phone.trim()) { setErr('Phone number is required'); return }
        if (!form.plot_id) { setErr('Please select a plot'); return }
        if (!form.start_date) { setErr('Start date is required'); return }
        setSaving(true)
        try {
            await ipc.invoke('db:add-tenant', form)
            onSaved()
        } catch (e: any) {
            setErr(e.message || 'Failed to save')
            setSaving(false)
        }
    }

    return (
        <div className="panel-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="panel" style={{ width: 520 }}>
                <div className="panel-header">
                    <h2>Add New Tenant</h2>
                    <button className="panel-close" onClick={onClose}><X size={16} /></button>
                </div>
                <div className="panel-body">
                    <TenantForm form={form} onChange={setForm} plots={plots} />
                    {err && (
                        <div className="msg msg-error" style={{ marginTop: 14 }}>
                            <span>{err}</span>
                            <button className="msg-close" onClick={() => setErr('')}>✕</button>
                        </div>
                    )}
                </div>
                <div className="panel-footer" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary btn-lg" onClick={handleSave}
                        disabled={saving || !form.tenant_id.trim() || !form.name.trim() || !form.cnic.trim() || !form.phone.trim() || !form.plot_id || !form.start_date}>
                        <Check size={15} />
                        {saving ? 'Saving...' : 'Save Tenant'}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ══════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════
export default function TenantsPage() {
    const [tenants, setTenants] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [search, setSearch] = useState('')
    const [selected, setSelected] = useState<any>(null)
    const [showAdd, setShowAdd] = useState(false)
    const [msg, setMsg] = useState('')
    const searchRef = useRef<HTMLInputElement>(null)

    const load = useCallback(async () => {
        if (!ipc) return
        setLoading(true)
        try {
            const data = await ipc.invoke('db:get-tenants')
            setTenants(data)
        } catch (e) { console.error(e) }
        finally { setLoading(false) }
    }, [])

    useEffect(() => { load() }, [load])

    const showSuccess = (m: string) => {
        setMsg(m)
        setTimeout(() => setMsg(''), 3500)
    }

    const q = search.toLowerCase().replace(/[-\s]/g, '')
    const displayed = q
        ? tenants.filter(t =>
            t.tenant_id?.replace(/[-\s]/g, '').toLowerCase().includes(q) ||
            t.name?.toLowerCase().includes(q) ||
            t.cnic?.replace(/[-\s]/g, '').toLowerCase().includes(q) ||
            t.phone?.replace(/[-\s]/g, '').toLowerCase().includes(q) ||
            t.plot_number?.toLowerCase().includes(q)
        )
        : tenants

    const activeCount = tenants.filter(t => !t.end_date || new Date(t.end_date) >= new Date()).length
    const endedCount = tenants.length - activeCount

    return (
        <div className="page">
            {/* ── Header ── */}
            <div className="page-header">
                <div>
                    <h1>Tenants</h1>
                    <p className="subtitle">
                        {activeCount} active
                        {endedCount > 0 && ` · ${endedCount} ended`}
                        {' · '}{tenants.length} total
                    </p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                    <Plus size={15} /> Add Tenant
                </button>
            </div>

            {msg && (
                <div className="msg msg-success" style={{ marginBottom: 16 }}>
                    <span>{msg}</span>
                    <button className="msg-close" onClick={() => setMsg('')}>✕</button>
                </div>
            )}

            {/* ── Table ── */}
            <div className="table-wrap">
                <div className="table-search">
                    <Search size={14} style={{ color: 'var(--t-faint)', flexShrink: 0 }} />
                    <input
                        ref={searchRef}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by Tenant ID, name, CNIC, phone, or plot number..."
                    />
                    {search && (
                        <button
                            onClick={() => setSearch('')}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--t-faint)', padding: '0 4px', display: 'flex'
                            }}>
                            <X size={13} />
                        </button>
                    )}
                    <span style={{
                        fontSize: 11, color: 'var(--t-faint)',
                        fontFamily: 'IBM Plex Mono', whiteSpace: 'nowrap', marginLeft: 8
                    }}>
                        {displayed.length} of {tenants.length}
                    </span>
                </div>

                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Tenant ID</th>
                            <th>Name</th>
                            <th>CNIC</th>
                            <th>Phone</th>
                            <th>Plot</th>
                            <th>Start Date</th>
                            <th>End Date</th>
                            <th style={{ textAlign: 'right' }}>Monthly Rent</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={9} style={{
                                textAlign: 'center', padding: 36,
                                color: 'var(--t-faint)', fontSize: 13
                            }}>Loading...</td></tr>
                        ) : displayed.length === 0 ? (
                            <tr><td colSpan={9} style={{
                                textAlign: 'center', padding: 40,
                                color: 'var(--t-faint)', fontSize: 13
                            }}>
                                {search
                                    ? `No tenants matching "${search}"`
                                    : 'No tenants yet. Click Add Tenant to get started.'}
                            </td></tr>
                        ) : displayed.map(t => {
                            const isActive = !t.end_date || t.end_date === '' || new Date(t.end_date) >= new Date()
                            return (
                                <tr key={t.id} onClick={() => setSelected(t)}>
                                    <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--t-muted)', letterSpacing: '0.01em' }}>
                                        {t.tenant_id || '—'}
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{
                                                width: 26, height: 26, borderRadius: '50%',
                                                background: isActive ? 'var(--accent-light)' : 'var(--bg-muted)',
                                                border: `1px solid ${isActive ? 'var(--accent-border)' : 'var(--border)'}`,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                flexShrink: 0
                                            }}>
                                                <User size={12} style={{ color: isActive ? 'var(--accent)' : 'var(--t-faint)' }} />
                                            </div>
                                            <span style={{ fontWeight: 500 }}>{t.name}</span>
                                        </div>
                                    </td>
                                    <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--t-muted)', letterSpacing: '0.01em' }}>
                                        {t.cnic || '—'}
                                    </td>
                                    <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--t-muted)' }}>
                                        {t.phone || '—'}
                                    </td>
                                    <td>
                                        {t.plot_number ? (
                                            <span className="badge badge-blue" style={{ fontSize: 11 }}>
                                                <Home size={10} style={{ marginRight: 3 }} />
                                                {t.plot_number}
                                            </span>
                                        ) : '—'}
                                    </td>
                                    <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--t-muted)' }}>
                                        {t.start_date || '—'}
                                    </td>
                                    <td style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--t-muted)' }}>
                                        {t.end_date || '—'}
                                    </td>
                                    <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontSize: 12, color: 'var(--t-muted)' }}>
                                        {t.monthly_rent ? fmt(t.monthly_rent) : '—'}
                                    </td>
                                    <td>
                                        <span className={`badge ${isActive ? 'badge-paid' : 'badge-gray'}`}>
                                            {isActive ? 'Active' : 'Ended'}
                                        </span>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
                <div className="table-footer">
                    <span>{displayed.length} tenants</span>
                    <span style={{ color: 'var(--t-faint)', fontSize: 11 }}>
                        Click any row to view details & statement
                    </span>
                </div>
            </div>

            {/* ── Panels ── */}
            {showAdd && (
                <AddTenantPanel
                    onClose={() => setShowAdd(false)}
                    onSaved={() => {
                        showSuccess('Tenant added successfully')
                        setShowAdd(false)
                        load()
                    }}
                />
            )}
            {selected && (
                <TenantPanel
                    tenant={selected}
                    onClose={() => setSelected(null)}
                    onSaved={() => {
                        showSuccess('Tenant updated')
                        setSelected(null)
                        load()
                    }}
                    onDeleted={() => {
                        showSuccess('Tenant deleted')
                        setSelected(null)
                        load()
                    }}
                />
            )}
        </div>
    )
}
