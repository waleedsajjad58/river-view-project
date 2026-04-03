import { useEffect, useRef, useState } from 'react'

const ipc = (window as any).ipcRenderer

export default function LoginPage({ onLogin }: { onLogin: (user: any) => void }) {
    const [pin,     setPin]     = useState('')
    const [error,   setError]   = useState('')
    const [loading, setLoading] = useState(false)
    const hiddenInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        hiddenInputRef.current?.focus()
    }, [])

    const handleLogin = async () => {
        if (pin.length < 4) { setError('PIN must be at least 4 digits'); return }
        setLoading(true); setError('')
        try {
            const result = await ipc.invoke('db:verify-pin', { username: 'admin', pin })
            if (result.success) {
                onLogin(result.user)
            } else {
                setError(result.message || 'Incorrect PIN')
                setPin('')
            }
        } catch (e: any) {
            setError('System error: ' + e.message)
        } finally { setLoading(false) }
    }

    const append = (d: string) => {
        setError('')
        if (pin.length < 6) setPin(p => p + d)
    }

    return (
        <div style={{
            minHeight: '100vh', width: '100vw', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-subtle)', fontFamily: 'var(--font)'
        }} onClick={() => hiddenInputRef.current?.focus()}>
            <div style={{ width: 360, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>

                {/* Logo + title */}
                <div style={{ textAlign: 'center' }}>
                    <div style={{
                        width: 56, height: 56, borderRadius: 12, background: 'var(--accent)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, fontWeight: 700, color: '#fff',
                        fontFamily: 'var(--font-mono)', margin: '0 auto 14px',
                        boxShadow: '0 4px 14px rgba(29,78,216,0.3)'
                    }}>RV</div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--t-primary)', letterSpacing: '-0.02em' }}>
                        River View ERP
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--t-faint)', marginTop: 4 }}>
                        Co-operative Housing Society, Lahore
                    </div>
                </div>

                {/* PIN card */}
                <div style={{
                    background: '#fff', border: '1px solid var(--border)', borderRadius: 10,
                    padding: '28px 28px 24px', width: '100%',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.07)'
                }}>
                    <div style={{ fontSize: 12.5, color: 'var(--t-faint)', textAlign: 'center', marginBottom: 20 }}>
                        Enter your PIN to continue
                    </div>

                    {/* Dot indicators */}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 20 }}>
                        {[0,1,2,3].map(i => (
                            <div key={i} style={{
                                width: 13, height: 13, borderRadius: '50%', transition: 'background 0.15s',
                                background: i < pin.length ? 'var(--accent)' : 'var(--border)',
                            }} />
                        ))}
                    </div>

                    {/* Hidden keyboard input (keeps physical keyboard support) */}
                    <input
                        ref={hiddenInputRef}
                        type="password"
                        value={pin}
                        onChange={e => { setError(''); setPin(e.target.value.replace(/\D/g,'').slice(0,6)) }}
                        onKeyDown={e => e.key === 'Enter' && handleLogin()}
                        style={{
                            position: 'absolute',
                            opacity: 0,
                            width: 1,
                            height: 1,
                            pointerEvents: 'none'
                        }}
                        maxLength={6}
                    />

                    {/* Numpad */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 14 }}>
                        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, i) => (
                            <button key={i}
                                onClick={() => d === '⌫' ? (setError(''), setPin(p => p.slice(0,-1))) : d ? append(d) : null}
                                disabled={!d}
                                style={{
                                    height: 46, borderRadius: 'var(--r)',
                                    border: `1px solid ${d === '⌫' ? 'var(--c-overdue-border)' : 'var(--border)'}`,
                                    background: d === '⌫' ? 'var(--c-overdue-bg)' : '#fff',
                                    color: d === '⌫' ? 'var(--c-overdue)' : 'var(--t-primary)',
                                    fontSize: 15, fontWeight: 600, cursor: d ? 'pointer' : 'default',
                                    opacity: d ? 1 : 0, fontFamily: 'var(--font-mono)',
                                    transition: 'background 0.1s',
                                }}
                            >{d}</button>
                        ))}
                    </div>

                    {/* Error */}
                    {error && (
                        <div style={{
                            fontSize: 12, color: 'var(--c-overdue)', textAlign: 'center',
                            marginBottom: 10, padding: '6px 10px',
                            background: 'var(--c-overdue-bg)', borderRadius: 'var(--r)',
                            border: '1px solid var(--c-overdue-border)'
                        }}>
                            {error}
                        </div>
                    )}

                    {/* Login button */}
                    <button onClick={handleLogin} disabled={pin.length < 4 || loading}
                        style={{
                            width: '100%', height: 40, borderRadius: 'var(--r)', border: 'none',
                            background: pin.length >= 4 ? 'var(--accent)' : 'var(--border)',
                            color: '#fff', fontSize: 14, fontWeight: 600,
                            cursor: pin.length >= 4 ? 'pointer' : 'default',
                            transition: 'background 0.15s', fontFamily: 'var(--font)',
                        }}
                    >
                        {loading ? 'Verifying…' : 'Login'}
                    </button>
                </div>
            </div>
        </div>
    )
}