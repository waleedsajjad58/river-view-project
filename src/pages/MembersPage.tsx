import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, X, Search, User, Home, FileText, Check, Trash2, Edit2, Download } from 'lucide-react'
import { exportExcelFile } from '../utils/exportExcel'

const ipc = (window as any).ipcRenderer
const fmt = (n: number) => `Rs. ${(n || 0).toLocaleString()}`

const CNIC_MAX_LEN = 15 // 35201-1234567-1
const PHONE_MAX_LEN = 12 // 0300-1234567

function normalizeCnicInput(value: string) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 13)
    const p1 = digits.slice(0, 5)
    const p2 = digits.slice(5, 12)
    const p3 = digits.slice(12, 13)
    if (!p1) return ''
    if (!p2) return p1
    if (!p3) return `${p1}-${p2}`
    return `${p1}-${p2}-${p3}`
}

function normalizePhoneInput(value: string) {
    let digits = String(value || '').replace(/\D/g, '')
    if (digits.startsWith('92') && digits.length >= 12) {
        digits = `0${digits.slice(2)}`
    }
    digits = digits.slice(0, 11)
    const p1 = digits.slice(0, 4)
    const p2 = digits.slice(4, 11)
    if (!p1) return ''
    if (!p2) return p1
    return `${p1}-${p2}`
}

function isValidCnic(value: string) {
    return String(value || '').replace(/\D/g, '').length === 13
}

function isValidPhone(value: string) {
    return String(value || '').replace(/\D/g, '').length === 11
}

const PLOT_TYPE_LABELS: Record<string, string> = {
    residential_constructed: 'Residential',
    residential_vacant: 'Vacant',
    commercial: 'Commercial',
}

// ── Styled toggle checkbox ────────────────────────────────────
function Toggle({ checked, onChange, label }: { checked: boolean, onChange: (v: boolean) => void, label: string }) {
    return (
        <button
            type="button"
            onClick={() => onChange(!checked)}
            style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 0, textAlign: 'left'
            }}
        >
            <div style={{
                width: 36, height: 20, borderRadius: 10,
                background: checked ? 'var(--accent)' : 'var(--border-strong)',
                position: 'relative', transition: 'background .15s', flexShrink: 0
            }}>
                <div style={{
                    position: 'absolute', top: 2, left: checked ? 18 : 2,
                    width: 16, height: 16, borderRadius: '50%', background: '#fff',
                    boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                    transition: 'left .15s'
                }} />
            </div>
            <span style={{ fontSize: 13, color: 'var(--t-secondary)', fontWeight: 500 }}>{label}</span>
        </button>
    )
}

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

// ── Member form (reused for add + edit) ───────────────────────
function MemberForm({
    form,
    onChange,
    assignablePlots,
    ownedPlotIds = []
}: {
    form: any,
    onChange: (f: any) => void,
    assignablePlots: any[],
    ownedPlotIds?: number[]
}) {
    const set = (k: string, v: any) => onChange({ ...form, [k]: v })
    const selectedPlotId = Number(form.assign_plot_id || 0)
    const alreadyOwned = selectedPlotId > 0 && ownedPlotIds.includes(selectedPlotId)
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Row 1 */}
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
                    <label>Member ID *</label>
                    <input type="text" value={form.member_id || ''}
                        onChange={e => set('member_id', e.target.value)}
                        placeholder="e.g. MEM-00001"
                        style={{ fontFamily: 'IBM Plex Mono', letterSpacing: '0.02em' }}
                    />
                </div>
            </div>
            {/* Row 2 */}
            <div className="form-grid">
                <div className="form-group">
                    <label>CNIC *</label>
                    <input type="text" value={form.cnic}
                        onChange={e => set('cnic', normalizeCnicInput(e.target.value))}
                        maxLength={CNIC_MAX_LEN}
                        placeholder="35201-1234567-1"
                        style={{ fontFamily: 'IBM Plex Mono', letterSpacing: '0.02em' }}
                    />
                </div>
                <div className="form-group">
                    <label>Phone *</label>
                    <input type="text" value={form.phone}
                        onChange={e => set('phone', normalizePhoneInput(e.target.value))}
                        maxLength={PHONE_MAX_LEN}
                        placeholder="0300-1234567"
                        style={{ fontFamily: 'IBM Plex Mono' }}
                    />
                </div>
            </div>
            {/* Row 3 */}
            <div className="form-grid">
                <div className="form-group">
                    <label>Membership Date *</label>
                    <input type="date" value={form.membership_date}
                        onChange={e => set('membership_date', e.target.value)} />
                </div>
            </div>
            {/* Optional plot assignment */}
            <div style={{
                background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)', padding: '12px 14px'
            }}>
                <div style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.07em', color: 'var(--t-faint)',
                    fontFamily: 'IBM Plex Mono', marginBottom: 10
                }}>
                    Plot Assignment (Optional)
                </div>
                <div className="form-grid">
                    <div className="form-group">
                        <label>Assign Plot</label>
                        <select
                            value={form.assign_plot_id || ''}
                            onChange={e => set('assign_plot_id', e.target.value)}
                        >
                            <option value="">No plot assignment</option>
                            {assignablePlots.map((p: any) => (
                                <option key={p.id} value={p.id}>
                                    Plot {p.plot_number}{p.block ? ` (${p.block})` : ''}
                                </option>
                            ))}
                        </select>
                        {assignablePlots.length === 0 && (
                            <span style={{ fontSize: 11, color: 'var(--t-faint)', marginTop: 3 }}>
                                No unassigned plots available right now.
                            </span>
                        )}
                    </div>
                    <div className="form-group">
                        <label>Assignment Date</label>
                        <input
                            type="date"
                            value={form.plot_assignment_date || ''}
                            onChange={e => set('plot_assignment_date', e.target.value)}
                            disabled={!form.assign_plot_id}
                        />
                    </div>
                </div>
                {alreadyOwned && (
                    <div style={{ fontSize: 11.5, color: 'var(--t-faint)', marginTop: 4 }}>
                        This member already owns the selected plot.
                    </div>
                )}
            </div>

            {/* Toggle */}
            <div style={{ padding: '10px 0' }}>
                <Toggle
                    checked={!!form.is_member}
                    onChange={v => set('is_member', v ? 1 : 0)}
                    label="Active Member"
                />
            </div>
            {/* Notes */}
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

// ── Member statement view ─────────────────────────────────────
function MemberStatement({ memberId }: { memberId: number }) {
    const [data, setData] = useState<any>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!ipc || !memberId) return
        setLoading(true)
        ipc.invoke('db:get-member-statement', memberId)
            .then((d: any) => setData(d))
            .catch(console.error)
            .finally(() => setLoading(false))
    }, [memberId])

    if (loading) return (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--t-faint)', fontSize: 13 }}>
            Loading statement...
        </div>
    )
    if (!data) return null

    const { summary, plots, bills } = data

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

            {/* Owned plots */}
            {plots.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                    <div style={{
                        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.08em', color: 'var(--t-faint)',
                        fontFamily: 'IBM Plex Mono', marginBottom: 8
                    }}>
                        Owned Plots
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {plots.map((p: any) => (
                            <div key={p.id} style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                background: 'var(--accent-light)', border: '1px solid var(--accent-border)',
                                borderRadius: 'var(--r)', padding: '5px 10px', fontSize: 12.5
                            }}>
                                <Home size={12} style={{ color: 'var(--accent)' }} />
                                <span style={{ fontWeight: 600, fontFamily: 'IBM Plex Mono', color: 'var(--accent)' }}>
                                    Plot {p.plot_number}
                                </span>
                                <span style={{ color: 'var(--t-muted)', fontSize: 11 }}>
                                    {p.marla_size} · {PLOT_TYPE_LABELS[p.plot_type] || p.plot_type}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

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
                                    No bills found for this member.
                                </td>
                            </tr>
                        ) : bills.map((b: any) => (
                            <tr key={b.id}>
                                <td style={{
                                    fontFamily: 'IBM Plex Mono', fontSize: 11.5,
                                    color: 'var(--t-faint)'
                                }}>
                                    {b.bill_number}
                                </td>
                                <td style={{ fontWeight: 600, fontFamily: 'IBM Plex Mono', fontSize: 12 }}>
                                    {b.plot_number}
                                </td>
                                <td style={{
                                    fontFamily: 'IBM Plex Mono', fontSize: 12,
                                    color: 'var(--t-muted)'
                                }}>
                                    {b.billing_month || '—'}
                                </td>
                                <td style={{
                                    fontFamily: 'IBM Plex Mono', fontSize: 11.5,
                                    color: 'var(--t-faint)'
                                }}>
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

// ── Member detail / edit panel ────────────────────────────────
type PanelTab = 'overview' | 'statement'
type PanelMode = 'view' | 'edit'

// ── Read-only member info block ───────────────────────────────
function MemberInfo({ member, plots }: { member: any, plots: any[] }) {
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

    return (
        <div>
            {row('Full Name', member.name)}
            {row('Member ID', member.member_id, true)}
            {row('CNIC', member.cnic, true)}
            {row('Phone', member.phone, true)}
            {row('Joined', member.membership_date)}
            {row('Status', member.is_member ? 'Active Member' : 'Inactive')}
            {member.notes && row('Notes', member.notes)}

            {plots.length > 0 && (
                <div style={{ paddingTop: 16 }}>
                    <div style={{
                        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                        letterSpacing: '0.05em', color: 'var(--t-faint)',
                        fontFamily: 'IBM Plex Mono', marginBottom: 10
                    }}>
                        Owned Plots
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {plots.map((p: any) => (
                            <div key={p.id} style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                background: 'var(--accent-light)', border: '1px solid var(--accent-border)',
                                borderRadius: 'var(--r)', padding: '5px 10px'
                            }}>
                                <Home size={11} style={{ color: 'var(--accent)' }} />
                                <span style={{
                                    fontWeight: 600, fontFamily: 'IBM Plex Mono',
                                    fontSize: 12, color: 'var(--accent)'
                                }}>
                                    Plot {p.plot_number}
                                </span>
                                <span style={{ color: 'var(--t-muted)', fontSize: 11 }}>
                                    {p.marla_size} · {PLOT_TYPE_LABELS[p.plot_type] || p.plot_type}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

function MemberPanel({ member, onClose, onSaved, onDeleted }: {
    member: any, onClose: () => void,
    onSaved: () => void, onDeleted: () => void
}) {
    const [tab, setTab] = useState<PanelTab>('overview')
    const [mode, setMode] = useState<PanelMode>('view')   // ← defaults to VIEW
    const [form, setForm] = useState({
        ...member,
        assign_plot_id: '',
        plot_assignment_date: member.membership_date || new Date().toISOString().split('T')[0]
    })
    const [saving, setSaving] = useState(false)
    const [plots, setPlots] = useState<any[]>([])
    const [allPlots, setAllPlots] = useState<any[]>([])
    const [confirm, setConfirm] = useState(false)
    const [err, setErr] = useState('')

    useEffect(() => {
        setForm({
            ...member,
            assign_plot_id: '',
            plot_assignment_date: member.membership_date || new Date().toISOString().split('T')[0]
        })
        setTab('overview')
        setMode('view')            // always open in view mode
        setConfirm(false)
        setErr('')
        if (ipc) {
            Promise.all([
                ipc.invoke('db:get-member-plots', member.id),
                ipc.invoke('db:get-plots')
            ])
                .then(([memberPlots, fetchedPlots]: [any[], any[]]) => {
                    setPlots(memberPlots || [])
                    setAllPlots(fetchedPlots || [])
                })
                .catch(() => {
                    setPlots([])
                    setAllPlots([])
                })
        }
    }, [member.id])

    const handleSave = async () => {
        if (!form.name.trim() || !String(form.member_id || '').trim() || !String(form.cnic || '').trim() || !String(form.phone || '').trim() || !String(form.membership_date || '').trim()) return
        if (!isValidCnic(form.cnic)) { setErr('CNIC must be exactly 13 digits'); return }
        if (!isValidPhone(form.phone)) { setErr('Phone number must be exactly 11 digits'); return }
        setSaving(true)
        setErr('')
        try {
            await ipc.invoke('db:update-member', { ...form, id: member.id, share_count: 4 })
            const selectedPlotId = Number(form.assign_plot_id || 0)
            const alreadyOwned = plots.some(p => p.id === selectedPlotId)
            if (selectedPlotId > 0 && !alreadyOwned) {
                await ipc.invoke('db:assign-owner', {
                    plotId: selectedPlotId,
                    memberId: member.id,
                    startDate: form.plot_assignment_date || form.membership_date
                })
            }
            onSaved()
        } catch (e: any) {
            setErr(e?.message || 'Failed to save member')
            setSaving(false)
        }
    }

    const handleDelete = async () => {
        await ipc.invoke('db:delete-member', member.id)
        onDeleted()
    }

    const cancelEdit = () => {
        setForm({
            ...member,
            assign_plot_id: '',
            plot_assignment_date: member.membership_date || new Date().toISOString().split('T')[0]
        })   // discard changes
        setMode('view')
        setConfirm(false)
        setErr('')
    }

    const ownedPlotIds = plots.map(p => p.id)
    const assignablePlots = allPlots.filter((p: any) => !p.owner_name || ownedPlotIds.includes(p.id))

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
                            <div style={{
                                fontSize: 14, fontWeight: 600, color: 'var(--t-primary)',
                                letterSpacing: '-0.01em'
                            }}>
                                {member.name}
                            </div>
                            {(member.member_id || member.cnic) && (
                                <div style={{
                                    fontSize: 11, color: 'var(--t-faint)',
                                    fontFamily: 'IBM Plex Mono'
                                }}>
                                    {(member.member_id || '').trim() || member.cnic}
                                </div>
                            )}
                        </div>
                        <span className={`badge ${member.is_member ? 'badge-paid' : 'badge-gray'}`}
                            style={{ marginLeft: 4 }}>
                            {member.is_member ? 'Active' : 'Inactive'}
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
                        <MemberInfo member={member} plots={plots} />
                    )}
                    {tab === 'overview' && mode === 'edit' && (
                        <MemberForm
                            form={form}
                            onChange={setForm}
                            assignablePlots={assignablePlots}
                            ownedPlotIds={ownedPlotIds}
                        />
                    )}
                    {tab === 'statement' && (
                        <MemberStatement memberId={member.id} />
                    )}
                    {tab === 'overview' && mode === 'edit' && err && (
                        <div className="msg msg-error" style={{ marginTop: 14 }}>
                            <span>{err}</span>
                            <button className="msg-close" onClick={() => setErr('')}>✕</button>
                        </div>
                    )}
                </div>

                {/* ── Footer ── */}
                <div className="panel-footer" style={{ justifyContent: 'space-between' }}>
                    {/* Left: delete (only in view mode) */}
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
                                    <button className="btn btn-ghost btn-sm"
                                        onClick={() => setConfirm(false)}>
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <button className="btn btn-ghost btn-sm"
                                    style={{
                                        color: 'var(--c-overdue)',
                                        borderColor: 'var(--c-overdue-border)'
                                    }}
                                    onClick={() => setConfirm(true)}>
                                    <Trash2 size={13} /> Delete
                                </button>
                            )
                        )}
                    </div>

                    {/* Right: context-sensitive action buttons */}
                    <div style={{ display: 'flex', gap: 8 }}>
                        {mode === 'view' ? (
                            <>
                                <button className="btn btn-ghost" onClick={onClose}>Close</button>
                                {tab === 'overview' && (
                                    <button className="btn btn-primary"
                                        onClick={() => setMode('edit')}>
                                        <Edit2 size={13} /> Edit Member
                                    </button>
                                )}
                            </>
                        ) : (
                            <>
                                <button className="btn btn-ghost" onClick={cancelEdit}>
                                    Cancel
                                </button>
                                <button className="btn btn-primary" onClick={handleSave}
                                    disabled={
                                        saving ||
                                        !form.name.trim() ||
                                        !String(form.member_id || '').trim() ||
                                        !isValidCnic(form.cnic) ||
                                        !isValidPhone(form.phone) ||
                                        !String(form.membership_date || '').trim()
                                    }>
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

// ── Add member panel ──────────────────────────────────────────
function AddMemberPanel({ onClose, onSaved }: { onClose: () => void, onSaved: () => void }) {
    const [form, setForm] = useState({
        member_id: '', name: '', cnic: '', phone: '',
        is_member: 1, membership_date: '', notes: '',
        assign_plot_id: '', plot_assignment_date: new Date().toISOString().split('T')[0]
    })
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState('')
    const [allPlots, setAllPlots] = useState<any[]>([])

    useEffect(() => {
        if (!ipc) return
        ipc.invoke('db:get-plots')
            .then((p: any[]) => setAllPlots(p || []))
            .catch(() => setAllPlots([]))
    }, [])

    const handleSave = async () => {
        if (!form.name.trim()) { setErr('Name is required'); return }
        if (!form.member_id.trim()) { setErr('Member ID is required'); return }
        if (!form.cnic.trim()) { setErr('CNIC is required'); return }
        if (!form.phone.trim()) { setErr('Phone number is required'); return }
        if (!form.membership_date.trim()) { setErr('Membership date is required'); return }
        if (!isValidCnic(form.cnic)) { setErr('CNIC must be exactly 13 digits'); return }
        if (!isValidPhone(form.phone)) { setErr('Phone number must be exactly 11 digits'); return }
        setSaving(true)
        setErr('')
        try {
            const result = await ipc.invoke('db:add-member', { ...form, share_count: 4 })
            const memberId = Number(result?.lastInsertRowid || 0)
            const selectedPlotId = Number(form.assign_plot_id || 0)
            if (selectedPlotId > 0 && memberId > 0) {
                await ipc.invoke('db:assign-owner', {
                    plotId: selectedPlotId,
                    memberId,
                    startDate: form.plot_assignment_date || form.membership_date
                })
            }
            onSaved()
        } catch (e: any) {
            setErr(e.message || 'Failed to save')
            setSaving(false)
        }
    }

    const assignablePlots = allPlots.filter((p: any) => !p.owner_name)

    return (
        <div className="panel-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="panel" style={{ width: 520 }}>
                <div className="panel-header">
                    <h2>Add New Member</h2>
                    <button className="panel-close" onClick={onClose}><X size={16} /></button>
                </div>
                <div className="panel-body">
                    <MemberForm
                        form={form}
                        onChange={setForm}
                        assignablePlots={assignablePlots}
                    />
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
                        disabled={
                            saving ||
                            !form.name.trim() ||
                            !form.member_id.trim() ||
                            !isValidCnic(form.cnic) ||
                            !isValidPhone(form.phone) ||
                            !form.membership_date.trim()
                        }>
                        <Check size={15} />
                        {saving ? 'Saving...' : 'Save Member'}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ══════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════
export default function MembersPage() {
    const [members, setMembers] = useState<any[]>([])
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
            const data = await ipc.invoke('db:get-members')
            setMembers(data)
        } catch (e) { console.error(e) }
        finally { setLoading(false) }
    }, [])

    useEffect(() => { load() }, [load])

    const showSuccess = (m: string) => {
        setMsg(m)
        setTimeout(() => setMsg(''), 3500)
    }

    // Search across member ID, name, CNIC, and phone
    const q = search.toLowerCase().replace(/[-\s]/g, '')
    const displayed = q
        ? members.filter(m =>
            m.member_id?.replace(/[-\s]/g, '').toLowerCase().includes(q) ||
            m.name?.toLowerCase().includes(q) ||
            m.cnic?.replace(/[-\s]/g, '').toLowerCase().includes(q) ||
            m.phone?.replace(/[-\s]/g, '').toLowerCase().includes(q)
        )
        : members

    const activeCount = members.filter(m => m.is_member).length
    const inactiveCount = members.filter(m => !m.is_member).length

    const handleExportMembers = async () => {
        const headers = ['Member ID', 'Name', 'CNIC', 'Phone', 'Status']
        const rows: (string | number)[][] = members.map(m => [
            m.member_id || '',
            m.name || '',
            m.cnic || '',
            m.phone || '',
            m.is_member ? 'Active' : 'Inactive',
        ])

        await exportExcelFile({
            fileName: `members-registry-${new Date().toISOString().split('T')[0]}`,
            sheetName: 'Members',
            title: 'River View Cooperative Housing Society Ltd.',
            subtitle: 'Members Registry',
            meta: [`Generated: ${new Date().toLocaleDateString('en-PK')} | Total Members: ${members.length} | Active: ${activeCount} | Inactive: ${inactiveCount}`],
            headers,
            rows,
            numericColumns: [1],
        })
    }

    return (
        <div className="page">
            {/* ── Header ── */}
            <div className="page-header">
                <div>
                    <h1>Members</h1>
                    <p className="subtitle">
                        {activeCount} active
                        {inactiveCount > 0 && ` · ${inactiveCount} inactive`}
                        {' · '}{members.length} total
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-ghost"
                        onClick={handleExportMembers}
                        title="Export to Excel">
                        <Download size={15} /> Export
                    </button>
                    <button className="btn btn-primary"
                        onClick={() => setShowAdd(true)}>
                        <Plus size={15} /> Add Member
                    </button>
                </div>
            </div>

            {msg && (
                <div className="msg msg-success" style={{ marginBottom: 16 }}>
                    <span>{msg}</span>
                    <button className="msg-close" onClick={() => setMsg('')}>✕</button>
                </div>
            )}

            {/* ── Table ── */}
            <div className="table-wrap">
                {/* Search bar — searches name, CNIC, phone simultaneously */}
                <div className="table-search">
                    <Search size={14} style={{ color: 'var(--t-faint)', flexShrink: 0 }} />
                    <input
                        ref={searchRef}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by Member ID, name, CNIC, or phone number..."
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
                        {displayed.length} of {members.length}
                    </span>
                </div>

                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Member ID</th>
                            <th>Name</th>
                            <th>CNIC</th>
                            <th>Phone</th>
                            <th>Plots Owned</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={6} style={{
                                textAlign: 'center', padding: 36,
                                color: 'var(--t-faint)', fontSize: 13
                            }}>
                                Loading...
                            </td></tr>
                        ) : displayed.length === 0 ? (
                            <tr><td colSpan={6} style={{
                                textAlign: 'center', padding: 40,
                                color: 'var(--t-faint)', fontSize: 13
                            }}>
                                {search
                                    ? `No members matching "${search}"`
                                    : 'No members yet. Click Add Member to get started.'}
                            </td></tr>
                        ) : displayed.map(m => (
                            <tr key={m.id} onClick={() => setSelected(m)}>
                                <td style={{
                                    fontFamily: 'IBM Plex Mono', fontSize: 12,
                                    color: 'var(--t-muted)', letterSpacing: '0.01em'
                                }}>
                                    {m.member_id || '—'}
                                </td>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <div style={{
                                            width: 26, height: 26, borderRadius: '50%',
                                            background: m.is_member ? 'var(--accent-light)' : 'var(--bg-muted)',
                                            border: `1px solid ${m.is_member ? 'var(--accent-border)' : 'var(--border)'}`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            flexShrink: 0
                                        }}>
                                            <User size={12} style={{
                                                color: m.is_member ? 'var(--accent)' : 'var(--t-faint)'
                                            }} />
                                        </div>
                                        <span style={{ fontWeight: 500 }}>{m.name}</span>
                                    </div>
                                </td>
                                <td style={{
                                    fontFamily: 'IBM Plex Mono', fontSize: 12,
                                    color: 'var(--t-muted)', letterSpacing: '0.01em'
                                }}>
                                    {m.cnic || '—'}
                                </td>
                                <td style={{
                                    fontFamily: 'IBM Plex Mono', fontSize: 12,
                                    color: 'var(--t-muted)'
                                }}>
                                    {m.phone || '—'}
                                </td>
                                <td>
                                    <MemberPlotsCell memberId={m.id} />
                                </td>
                                <td>
                                    <span className={`badge ${m.is_member ? 'badge-paid' : 'badge-gray'}`}>
                                        {m.is_member ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="table-footer">
                    <span>{displayed.length} members</span>
                    <span style={{ color: 'var(--t-faint)', fontSize: 11 }}>
                        Click any row to view details & statement
                    </span>
                </div>
            </div>

            {/* ── Panels ── */}
            {showAdd && (
                <AddMemberPanel
                    onClose={() => setShowAdd(false)}
                    onSaved={() => {
                        showSuccess('Member added successfully')
                        setShowAdd(false)
                        load()
                    }}
                />
            )}
            {selected && (
                <MemberPanel
                    member={selected}
                    onClose={() => setSelected(null)}
                    onSaved={() => {
                        showSuccess('Member updated')
                        setSelected(null)
                        load()
                    }}
                    onDeleted={() => {
                        showSuccess('Member deleted')
                        setSelected(null)
                        load()
                    }}
                />
            )}
        </div>
    )
}

// ── Lazy plot chips per row ───────────────────────────────────
// Fetched once per member row, cached in component state
function MemberPlotsCell({ memberId }: { memberId: number }) {
    const [plots, setPlots] = useState<any[] | null>(null)

    useEffect(() => {
        if (!ipc) return
        ipc.invoke('db:get-member-plots', memberId)
            .then((p: any[]) => setPlots(p || []))
            .catch(() => setPlots([]))
    }, [memberId])

    if (plots === null) return (
        <span style={{ fontSize: 11, color: 'var(--t-faint)' }}>…</span>
    )
    if (plots.length === 0) return (
        <span style={{ fontSize: 12, color: 'var(--t-faint)' }}>—</span>
    )
    return (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {plots.map(p => (
                <span key={p.id} className="badge badge-blue" style={{ fontSize: 10 }}>
                    <Home size={9} style={{ marginRight: 3 }} />
                    {p.plot_number}
                </span>
            ))}
        </div>
    )
}