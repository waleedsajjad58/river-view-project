import { useState, useEffect, useCallback } from 'react'
import { Database, Download, RefreshCw, AlertCircle, HardDrive, Save, Lock } from 'lucide-react'

const ipc = (window as any).ipcRenderer

const EDITABLE_SETTINGS = [
    { key: 'society_name', label: 'Society Name', type: 'text' },
    { key: 'society_address', label: 'Society Address', type: 'text' },
    { key: 'bill_number_prefix', label: 'Bill Number Prefix', type: 'text', placeholder: 'e.g. RV-' },
    { key: 'default_due_days', label: 'Default Due Days', type: 'number', placeholder: '15' },
    { key: 'late_fee_type', label: 'Late Fee Type', type: 'select', options: ['flat', 'percentage'] },
    { key: 'late_fee_value', label: 'Late Fee Amount / %', type: 'number', placeholder: '500' },
    { key: 'tenant_challan_amount', label: 'Tenant Challan Amount (Rs.)', type: 'number', placeholder: '2500' },
]

const PLOT_TYPE_LABELS: Record<string, string> = {
    residential_constructed: 'Residential (Constructed)',
    residential_vacant: 'Residential (Vacant)',
    commercial: 'Commercial',
}

export default function SettingsPage() {
    const [backups, setBackups] = useState<any[]>([])
    const [isBackingUp, setIsBackingUp] = useState(false)
    const [message, setMessage] = useState('')
    const [messageType, setMessageType] = useState<'success' | 'error'>('success')

    // Society settings state
    const [settings, setSettings] = useState<Record<string, string>>({})
    const [settingsDirty, setSettingsDirty] = useState(false)

    // Bill templates state
    const [templates, setTemplates] = useState<any[]>([])
    const [templatesDirty, setTemplatesDirty] = useState(false)

    // PIN change state
    const [currentPin, setCurrentPin] = useState('')
    const [newPin, setNewPin] = useState('')
    const [confirmPin, setConfirmPin] = useState('')

    // Active section
    const [section, setSection] = useState<'society' | 'billing' | 'months' | 'backup' | 'security'>('society')

    // Month locking state
    const [lockedMonths, setLockedMonths] = useState<any[]>([])
    const [lockMonth, setLockMonth] = useState('')
    const [lockNotes, setLockNotes] = useState('')

    const load = useCallback(async () => {
        if (!ipc) return
        const [logs, rawSettings, tmpl, locked] = await Promise.all([
            ipc.invoke('db:get-backup-log'),
            ipc.invoke('db:get-settings'),
            ipc.invoke('db:get-all-bill-templates'),
            ipc.invoke('db:get-locked-months'),
        ])
        setBackups(logs)
        const map: Record<string, string> = {}
        for (const s of rawSettings) map[s.key] = s.value
        setSettings(map)
        setTemplates(tmpl)
        setLockedMonths(locked)
    }, [])

    useEffect(() => { load() }, [load])

    const showMsg = (text: string, type: 'success' | 'error' = 'success') => {
        setMessage(text); setMessageType(type)
        if (type === 'success') setTimeout(() => setMessage(''), 4000)
    }

    const handleBackup = async () => {
        setIsBackingUp(true)
        try {
            const result = await ipc.invoke('db:create-backup')
            showMsg(`Backup created in Downloads: ${result.path}`)
            load()
        } catch (e: any) {
            showMsg(`Error: ${e.message}`, 'error')
        } finally {
            setIsBackingUp(false)
        }
    }

    const handleSaveSettings = async () => {
        try {
            const dueDays = Number.parseInt(String(settings.default_due_days || '').trim(), 10)
            if (!Number.isFinite(dueDays) || dueDays < 0) {
                showMsg('Default Due Days must be a non-negative whole number', 'error')
                return
            }

            const lateFeeType = String(settings.late_fee_type || '').trim().toLowerCase()
            if (!['flat', 'percentage'].includes(lateFeeType)) {
                showMsg('Late Fee Type must be flat or percentage', 'error')
                return
            }

            const lateFeeValue = Number.parseFloat(String(settings.late_fee_value || '').trim())
            if (!Number.isFinite(lateFeeValue) || lateFeeValue < 0) {
                showMsg('Late Fee Amount / % must be a non-negative number', 'error')
                return
            }

            const tenantChallanAmount = Number.parseFloat(String(settings.tenant_challan_amount || '').trim())
            if (!Number.isFinite(tenantChallanAmount) || tenantChallanAmount < 0) {
                showMsg('Tenant Challan Amount must be a non-negative number', 'error')
                return
            }

            const normalized: Record<string, string> = {
                ...settings,
                default_due_days: String(dueDays),
                late_fee_type: lateFeeType,
                late_fee_value: String(lateFeeValue),
                tenant_challan_amount: String(tenantChallanAmount),
            }

            const updates = EDITABLE_SETTINGS.map(s => ({ key: s.key, value: normalized[s.key] || '' }))
            await ipc.invoke('db:update-settings-bulk', updates)
            setSettings(normalized)
            setSettingsDirty(false)
            showMsg('Settings saved successfully')
        } catch (e: any) {
            showMsg(`Error: ${e.message}`, 'error')
        }
    }

    const handleSaveTemplates = async () => {
        try {
            for (const t of templates) {
                await ipc.invoke('db:update-bill-template', { id: t.id, amount: parseFloat(t.amount) || 0, isActive: t.is_active })
            }
            setTemplatesDirty(false)
            showMsg('Bill rates saved successfully')
        } catch (e: any) {
            showMsg(`Error: ${e.message}`, 'error')
        }
    }

    const handleChangePin = async () => {
        if (newPin !== confirmPin) { showMsg('New PINs do not match', 'error'); return }
        if (newPin.length < 4) { showMsg('PIN must be at least 4 digits', 'error'); return }
        try {
            await ipc.invoke('db:change-pin', { username: 'admin', currentPin, newPin })
            setCurrentPin(''); setNewPin(''); setConfirmPin('')
            showMsg('PIN changed successfully')
        } catch (e: any) {
            showMsg(`Error: ${e.message}`, 'error')
        }
    }

    const updateSetting = (key: string, value: string) => {
        setSettings(prev => ({ ...prev, [key]: value }))
        setSettingsDirty(true)
    }

    const updateTemplateAmount = (id: number, value: string) => {
        setTemplates(prev => prev.map(t => t.id === id ? { ...t, amount: value } : t))
        setTemplatesDirty(true)
    }

    const toggleTemplate = (id: number) => {
        setTemplates(prev => prev.map(t => t.id === id ? { ...t, is_active: t.is_active ? 0 : 1 } : t))
        setTemplatesDirty(true)
    }

    // Group templates by plot type
    const grouped = templates.reduce((acc: any, t: any) => {
        if (!acc[t.plot_type]) acc[t.plot_type] = []
        acc[t.plot_type].push(t)
        return acc
    }, {})

    const handleLockMonth = async () => {
        if (!lockMonth) { showMsg('Select a month to lock', 'error'); return }
        try {
            const result = await ipc.invoke('db:lock-month', { billingMonth: lockMonth, notes: lockNotes || null })
            showMsg(`${lockMonth} locked. ${result.openBillsAtLock > 0 ? `Warning: ${result.openBillsAtLock} unpaid bills remain.` : 'All clear.'}`)
            setLockMonth(''); setLockNotes('')
            load()
        } catch (e: any) { showMsg(`Error: ${e.message}`, 'error') }
    }

    const handleUnlockMonth = async (month: string) => {
        await ipc.invoke('db:unlock-month', { billingMonth: month, reason: 'Manual unlock from settings' })
        showMsg(`${month} unlocked`)
        load()
    }

    const SECTIONS = [
        { key: 'society', label: 'Society Info' },
        { key: 'billing', label: 'Bill Rates' },
        { key: 'months', label: 'Month Locking' },
        { key: 'backup', label: 'Backup & Export' },
        { key: 'security', label: 'Security' },
    ]

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1>Settings</h1>
                    <p className="subtitle">Society configuration, billing rates, backups</p>
                </div>
            </div>

            {message && (
                <div style={{ marginBottom: '1.5rem', padding: '0.9rem 1.2rem', borderRadius: '6px', background: messageType === 'error' ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)', color: messageType === 'error' ? 'var(--danger)' : 'var(--success)', borderLeft: `4px solid ${messageType === 'error' ? 'var(--danger)' : 'var(--success)'}`, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{message}</span>
                    <button onClick={() => setMessage('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '1.5rem' }}>
                {/* Left nav */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {SECTIONS.map(s => (
                        <button key={s.key} onClick={() => setSection(s.key as any)} style={{
                            padding: '0.7rem 1rem', borderRadius: '8px', border: 'none', textAlign: 'left', cursor: 'pointer',
                            background: section === s.key ? 'var(--accent)' : 'transparent',
                            color: section === s.key ? '#fff' : 'var(--text-secondary)',
                            fontWeight: section === s.key ? 600 : 400, fontSize: '0.9rem'
                        }}>{s.label}</button>
                    ))}
                </div>

                {/* Right content */}
                <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.75rem' }}>

                    {/* ── Society Info ── */}
                    {section === 'society' && <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h3>Society Information</h3>
                            <button className="btn btn-primary" onClick={handleSaveSettings} disabled={!settingsDirty}><Save size={16} /> Save Changes</button>
                        </div>
                        <div className="form-grid">
                            {EDITABLE_SETTINGS.map(s => (
                                <div key={s.key} className={`form-group ${s.type === 'text' && s.key.includes('address') ? 'full-width' : ''}`}>
                                    <label>{s.label}</label>
                                    {s.type === 'select' ? (
                                        <select value={settings[s.key] || ''} onChange={e => updateSetting(s.key, e.target.value)}>
                                            {s.options?.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
                                        </select>
                                    ) : (
                                        <input type={s.type} value={settings[s.key] || ''} onChange={e => updateSetting(s.key, e.target.value)} placeholder={s.placeholder} />
                                    )}
                                </div>
                            ))}
                        </div>
                        <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                            <button className="btn btn-primary" onClick={handleSaveSettings} disabled={!settingsDirty}><Save size={16} /> Save Changes</button>
                        </div>
                    </>}

                    {/* ── Bill Rates ── */}
                    {section === 'billing' && <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <div>
                                <h3>Bill Rate Templates</h3>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>Changes apply to newly generated bills only — existing bills are not affected.</p>
                            </div>
                            {templatesDirty && <button className="btn btn-primary" onClick={handleSaveTemplates}><Save size={16} /> Save Rates</button>}
                        </div>

                        {Object.entries(grouped).map(([plotType, items]: any) => (
                            <div key={plotType} style={{ marginBottom: '2rem' }}>
                                <h4 style={{ marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>{PLOT_TYPE_LABELS[plotType] || plotType}</h4>
                                <table className="detail-table">
                                    <thead><tr><th>Charge</th><th>Conditional</th><th style={{ width: '140px' }}>Amount (Rs.)</th><th style={{ width: '80px' }}>Active</th></tr></thead>
                                    <tbody>
                                        {items.map((t: any) => (
                                            <tr key={t.id} style={{ opacity: t.is_active ? 1 : 0.45 }}>
                                                <td>{t.charge_name}</td>
                                                <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                                    {t.is_conditional ? `If ${t.condition_field}` : '—'}
                                                </td>
                                                <td>
                                                    <input type="number" min="0" value={t.amount}
                                                        onChange={e => updateTemplateAmount(t.id, e.target.value)}
                                                        style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <input type="checkbox" checked={!!t.is_active} onChange={() => toggleTemplate(t.id)} />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ))}
                        {templatesDirty && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button className="btn btn-primary" onClick={handleSaveTemplates}><Save size={16} /> Save Rates</button>
                            </div>
                        )}
                    </>}

                    {/* ── Month Locking ── */}
                    {section === 'months' && <>
                        <div style={{ marginBottom: '1.5rem' }}>
                            <h3>Month Locking</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                                Lock a billing month to prevent any new bills from being generated or existing bills from being modified. This is standard accounting practice at period close.
                            </p>
                        </div>

                        <div style={{ padding: '1.25rem', background: 'var(--bg-card)', borderRadius: '10px', border: '1px solid var(--border)', marginBottom: '2rem' }}>
                            <h4 style={{ marginBottom: '1rem' }}>Lock a Month</h4>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label>Billing Month</label>
                                    <input type="month" value={lockMonth} onChange={e => setLockMonth(e.target.value)} />
                                </div>
                                <div className="form-group">
                                    <label>Notes (optional)</label>
                                    <input type="text" value={lockNotes} onChange={e => setLockNotes(e.target.value)} placeholder="e.g. Period closed by admin" />
                                </div>
                            </div>
                            <button className="btn btn-primary" onClick={handleLockMonth} disabled={!lockMonth} style={{ marginTop: '0.5rem' }}>
                                <Lock size={16} /> Lock Month
                            </button>
                        </div>

                        <h4 style={{ marginBottom: '1rem' }}>Locked Months</h4>
                        {lockedMonths.length === 0 ? (
                            <p className="text-muted" style={{ textAlign: 'center', padding: '2rem' }}>No months locked yet.</p>
                        ) : (
                            <table className="data-table">
                                <thead><tr><th>Month</th><th>Locked At</th><th>Notes</th><th></th></tr></thead>
                                <tbody>
                                    {lockedMonths.map((m: any) => (
                                        <tr key={m.id}>
                                            <td><strong>{m.billing_month}</strong></td>
                                            <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{new Date(m.locked_at).toLocaleString()}</td>
                                            <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{m.notes || '—'}</td>
                                            <td>
                                                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', fontSize: '0.8rem' }}
                                                    onClick={() => handleUnlockMonth(m.billing_month)}>
                                                    Unlock
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </>}

                    {/* ── Backup & Export ── */}
                    {section === 'backup' && <>
                        <h3 style={{ marginBottom: '1.5rem' }}>Backup & Data Export</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                            <div style={{ padding: '1.25rem', background: 'var(--bg-card)', borderRadius: '10px', border: '1px solid var(--border)' }}>
                                <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}><Database size={18} color="var(--accent)" /> Database Backup</h4>
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>Creates a full snapshot stored in your Downloads folder.</p>
                                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={handleBackup} disabled={isBackingUp}>
                                    {isBackingUp ? <><RefreshCw size={16} /> Creating...</> : <><HardDrive size={16} /> Create Backup</>}
                                </button>
                            </div>
                            <div style={{ padding: '1.25rem', background: 'var(--bg-card)', borderRadius: '10px', border: '1px solid var(--border)' }}>
                                <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}><Download size={18} color="var(--success)" /> Export to Excel</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {['plots', 'members', 'bills', 'expenditures'].map(type => (
                                        <button key={type} className="btn btn-ghost" style={{ justifyContent: 'flex-start', border: '1px solid var(--border)', textTransform: 'capitalize' }}
                                            onClick={() => ipc && ipc.invoke('db:export-spreadsheet', type)}>
                                            Export {type}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <h4 style={{ marginBottom: '1rem' }}>Backup History</h4>
                        {backups.length > 0 && (
                            <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem', background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '8px' }}>
                                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--success)' }} />
                                <span style={{ fontSize: '0.85rem' }}>Last backup: <strong>{new Date(backups[0].backup_date).toLocaleString()}</strong></span>
                            </div>
                        )}
                        <table className="data-table">
                            <thead><tr><th>Date & Time</th><th>Type</th><th>Size</th></tr></thead>
                            <tbody>
                                {backups.length === 0
                                    ? <tr><td colSpan={3} className="empty-row">No backups yet.</td></tr>
                                    : backups.map((b: any) => (
                                        <tr key={b.id}>
                                            <td>{b.backup_date}</td>
                                            <td><span className={`badge ${b.backup_type === 'auto' ? 'badge-blue' : 'badge-purple'}`}>{b.backup_type}</span></td>
                                            <td>{Math.round(b.file_size / 1024)} KB</td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </>}

                    {/* ── Security ── */}
                    {section === 'security' && <>
                        <h3 style={{ marginBottom: '0.5rem' }}>Change PIN</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Update the administrator login PIN.</p>
                        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                            <div className="form-group">
                                <label>Current PIN</label>
                                <input type="password" value={currentPin} onChange={e => setCurrentPin(e.target.value.replace(/\D/g, ''))} maxLength={6} placeholder="Enter current PIN" />
                            </div>
                            <div className="form-group">
                                <label>New PIN</label>
                                <input type="password" value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))} maxLength={6} placeholder="Min 4 digits" />
                            </div>
                            <div className="form-group">
                                <label>Confirm New PIN</label>
                                <input type="password" value={confirmPin} onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))} maxLength={6} placeholder="Repeat new PIN" />
                            </div>
                        </div>
                        <div style={{ marginTop: '1rem' }}>
                            <button className="btn btn-primary" onClick={handleChangePin} disabled={!currentPin || !newPin || !confirmPin}>
                                <Lock size={16} /> Update PIN
                            </button>
                        </div>
                    </>}

                </div>
            </div>
        </div>
    )
}