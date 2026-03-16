import { useState } from 'react'
import { FileUp, Eye, CheckCircle, AlertTriangle, Loader, Trash2 } from 'lucide-react'

const ipc = (window as any).ipcRenderer

type Preview = {
    plotCount: number
    memberCount: number
    paymentCount: number
    expenseCount: number
    samplePlots: { plot_number: string }[]
    sampleMembers: { membership_number: string; name: string }[]
    samplePayments: { date: string; plot_number: string; member_name: string; total: number }[]
    sampleExpenses: { category: string; month: string; amount: number }[]
}

type Step = 'idle' | 'previewing' | 'preview_done' | 'importing' | 'done' | 'error'

export default function ImportPage() {
    const [filePath, setFilePath] = useState<string | null>(null)
    const [preview, setPreview] = useState<Preview | null>(null)
    const [step, setStep] = useState<Step>('idle')
    const [result, setResult] = useState<any>(null)
    const [error, setError] = useState('')

    const fmt = (n: number) => n.toLocaleString('en-PK')

    async function handleSelectFile() {
        setError(''); setPreview(null); setResult(null); setStep('idle')
        const path = await ipc.invoke('db:import-select-file')
        if (!path) return
        setFilePath(path)
        setStep('previewing')
        try {
            const data = await ipc.invoke('db:import-preview', path)
            setPreview(data)
            setStep('preview_done')
        } catch (e: any) {
            setError(e?.message || 'Failed to read file')
            setStep('error')
        }
    }

    async function handleImport() {
        if (!filePath) return
        setStep('importing'); setError('')
        try {
            const res = await ipc.invoke('db:import-execute', { filePath })
            setResult(res)
            setStep('done')
        } catch (e: any) {
            setError(e?.message || 'Import failed')
            setStep('error')
        }
    }

    function handleReset() {
        setFilePath(null); setPreview(null); setResult(null)
        setStep('idle'); setError('')
    }

    return (
        <div className="page-root">
            <div className="page-header">
                <h1 className="page-title">Import Data from Excel</h1>
                <p style={{ color: 'var(--t-faint)', fontSize: '0.85rem', margin: 0 }}>
                    Import historical receipts and expenses from your River View Excel ledger files
                </p>
            </div>

            {/* Warning banner */}
            <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '0.9rem 1.1rem', marginBottom: '1.5rem', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <AlertTriangle size={18} color="#C2410C" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: '0.85rem', color: '#7C2D12' }}>
                    <strong>Before importing:</strong> Make sure you have deleted any test/dummy data first (delete <code>riverview_erp.db</code> and restart the app to get a clean database). Importing into an existing database will add duplicate records.
                </div>
            </div>

            {/* Step 1 — Select File */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.5rem', marginBottom: '1.2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: step === 'idle' ? 'var(--accent)' : '#22C55E', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                        {step === 'idle' ? '1' : '✓'}
                    </div>
                    <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Select Excel File</h2>
                </div>

                {filePath ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, background: 'var(--bg-subtle)', borderRadius: 6, padding: '0.5rem 0.8rem', fontSize: '0.82rem', fontFamily: 'IBM Plex Mono', color: 'var(--t-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {filePath}
                        </div>
                        <button className="btn btn-ghost" onClick={handleReset} style={{ flexShrink: 0 }}>
                            <Trash2 size={15} /> Clear
                        </button>
                    </div>
                ) : (
                    <button className="btn btn-primary" onClick={handleSelectFile}>
                        <FileUp size={16} /> Choose Excel File (.xlsx)
                    </button>
                )}
            </div>

            {/* Step 2 — Preview */}
            {(step === 'previewing' || step === 'preview_done' || step === 'importing' || step === 'done') && (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.5rem', marginBottom: '1.2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem' }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: step === 'previewing' ? 'var(--accent)' : '#22C55E', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                            {step === 'previewing' ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : '✓'}
                        </div>
                        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Preview</h2>
                    </div>

                    {step === 'previewing' && (
                        <p style={{ color: 'var(--t-faint)', fontSize: '0.85rem' }}>Reading file…</p>
                    )}

                    {preview && (
                        <>
                            {/* KPI strip */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.8rem', marginBottom: '1.2rem' }}>
                                {[
                                    { label: 'Plots', value: preview.plotCount },
                                    { label: 'Members', value: preview.memberCount },
                                    { label: 'Payment Rows', value: preview.paymentCount },
                                    { label: 'Expense Rows', value: preview.expenseCount },
                                ].map(k => (
                                    <div key={k.label} style={{ background: 'var(--bg-subtle)', borderRadius: 8, padding: '0.8rem 1rem' }}>
                                        <div style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'IBM Plex Mono', color: 'var(--accent)' }}>{fmt(k.value)}</div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--t-faint)' }}>{k.label} found</div>
                                    </div>
                                ))}
                            </div>

                            {/* Sample tables */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                {/* Sample members */}
                                <div>
                                    <p style={{ margin: '0 0 0.4rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--t-muted)' }}>SAMPLE MEMBERS (first 5)</p>
                                    <table className="data-table" style={{ fontSize: '0.8rem' }}>
                                        <thead><tr><th>Mem #</th><th>Name</th></tr></thead>
                                        <tbody>
                                            {preview.sampleMembers.map((m, i) => (
                                                <tr key={i}><td style={{ fontFamily: 'IBM Plex Mono' }}>{m.membership_number}</td><td>{m.name}</td></tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Sample expenses */}
                                <div>
                                    <p style={{ margin: '0 0 0.4rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--t-muted)' }}>SAMPLE EXPENSES (first 5)</p>
                                    <table className="data-table" style={{ fontSize: '0.8rem' }}>
                                        <thead><tr><th>Category</th><th>Month</th><th style={{ textAlign: 'right' }}>Rs.</th></tr></thead>
                                        <tbody>
                                            {preview.sampleExpenses.map((e, i) => (
                                                <tr key={i}>
                                                    <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.category}</td>
                                                    <td>{e.month}</td>
                                                    <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono' }}>{fmt(e.amount)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Sample payments */}
                            <p style={{ margin: '0 0 0.4rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--t-muted)' }}>SAMPLE PAYMENT ROWS (first 5)</p>
                            <table className="data-table" style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>
                                <thead><tr><th>Date</th><th>Plot</th><th>Member</th><th style={{ textAlign: 'right' }}>Total Rs.</th></tr></thead>
                                <tbody>
                                    {preview.samplePayments.map((p, i) => (
                                        <tr key={i}>
                                            <td style={{ fontFamily: 'IBM Plex Mono' }}>{p.date}</td>
                                            <td>{p.plot_number}</td>
                                            <td>{p.member_name}</td>
                                            <td style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 600 }}>{fmt(p.total)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, padding: '0.7rem 1rem', fontSize: '0.83rem', color: '#1E40AF' }}>
                                <Eye size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                                This is a <strong>preview only</strong> — nothing has been written to the database yet. Review the numbers above then click Import below.
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Step 3 — Import */}
            {step === 'preview_done' && (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.5rem', marginBottom: '1.2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem' }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>3</div>
                        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Confirm & Import</h2>
                    </div>
                    <p style={{ color: 'var(--t-faint)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                        Clicking Import will write all records to the database. This cannot be undone without deleting the database file.
                    </p>
                    <button className="btn btn-primary" onClick={handleImport}>
                        <CheckCircle size={16} /> Run Import
                    </button>
                </div>
            )}

            {/* Importing spinner */}
            {step === 'importing' && (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.5rem', marginBottom: '1.2rem', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Loader size={20} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />
                    <span style={{ color: 'var(--t-muted)' }}>Importing… please wait, do not close the app.</span>
                </div>
            )}

            {/* Done */}
            {step === 'done' && result && (
                <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, padding: '1.5rem', marginBottom: '1.2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem' }}>
                        <CheckCircle size={22} color="#15803D" />
                        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#15803D' }}>Import Complete</h2>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.8rem', marginBottom: '1rem' }}>
                        {[
                            { label: 'Plots inserted', value: result.plots },
                            { label: 'Members inserted', value: result.members },
                            { label: 'Payment entries', value: result.payments },
                            { label: 'Expense entries', value: result.expenses },
                        ].map(k => (
                            <div key={k.label} style={{ background: '#DCFCE7', borderRadius: 8, padding: '0.7rem 1rem' }}>
                                <div style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'IBM Plex Mono', color: '#15803D' }}>{fmt(k.value)}</div>
                                <div style={{ fontSize: '0.78rem', color: '#166534' }}>{k.label}</div>
                            </div>
                        ))}
                    </div>
                    {result.errors?.length > 0 && (
                        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '0.7rem 1rem', fontSize: '0.82rem', color: '#991B1B' }}>
                            <strong>{result.errors.length} warnings:</strong>
                            <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
                                {result.errors.slice(0, 10).map((e: string, i: number) => <li key={i}>{e}</li>)}
                            </ul>
                        </div>
                    )}
                    <p style={{ margin: '1rem 0 0', fontSize: '0.83rem', color: '#166534' }}>
                        Go to Cash Book, Ledger, or Members to verify the imported data.
                    </p>
                </div>
            )}

            {/* Error */}
            {step === 'error' && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '1.2rem 1.4rem', marginBottom: '1.2rem', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <AlertTriangle size={18} color="#DC2626" style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                        <strong style={{ color: '#DC2626' }}>Error</strong>
                        <p style={{ margin: '0.3rem 0 0', fontSize: '0.85rem', color: '#7F1D1D' }}>{error}</p>
                        <button className="btn btn-ghost" style={{ marginTop: '0.6rem' }} onClick={handleReset}>Try again</button>
                    </div>
                </div>
            )}

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    )
}