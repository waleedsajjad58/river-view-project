import { Suspense, lazy, useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, CreditCard, BookOpen, Settings,
  ChevronLeft, ChevronRight, BarChart3,
  LogOut, Users, Map, Wallet, ScrollText, BookMarked, FileUp, UserCheck, Landmark
} from 'lucide-react'

import LoginPage from './pages/LoginPage'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ImportPage = lazy(() => import('./pages/ImportPage'))
const BillingPage = lazy(() => import('./pages/BillingPage'))
const ExpenditurePage = lazy(() => import('./pages/ExpenditurePage'))
const CashBookPage = lazy(() => import('./pages/CashBookPage'))
const CashToBankPage = lazy(() => import('./pages/CashToBankPage'))
const AccountLedgerPage = lazy(() => import('./pages/AccountLedgerPage'))
const JournalEntriesPage = lazy(() => import('./pages/JournalEntriesPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const PlotsPage = lazy(() => import('./pages/PlotsPage'))
const MembersPage = lazy(() => import('./pages/MembersPage'))
const TenantsPage = lazy(() => import('./pages/TenantsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function NavLabel({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) return <div style={{ height: '0.75rem' }} />
  return <div className="nav-section-label">{label}</div>
}

export default function App() {
  const ipc = (window as any).ipcRenderer
  const showImportDataNav = false
  const [user, setUser] = useState<any>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    const saved = Number(localStorage.getItem('app.zoomLevel') || '100')
    if (Number.isNaN(saved)) return 100
    return Math.min(150, Math.max(80, saved))
  })
  const location = useLocation()
  const path = location.pathname

  useEffect(() => {
    const applyZoom = async () => {
      const factor = Math.min(1.5, Math.max(0.8, zoomLevel / 100))
      try {
        if (ipc) {
          await ipc.invoke('app:set-zoom-factor', { factor })
        }
      } catch {
        // Fallback only if IPC handler is temporarily unavailable.
        document.body.style.zoom = `${zoomLevel}%`
      }
      localStorage.setItem('app.zoomLevel', String(zoomLevel))
    }
    applyZoom()
  }, [zoomLevel])

  const changeZoom = (delta: number) => {
    setZoomLevel(prev => Math.min(150, Math.max(80, prev + delta)))
  }

  const handleLogin = (nextUser: any) => {
    setUser(nextUser)
  }

  const handleLogout = () => {
    setUser(null)
  }

  if (!user) return <LoginPage onLogin={handleLogin} />

  return (
    <div className="app-container">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>

        <div className="sidebar-header">
          <div className="logo">RV</div>
          {!collapsed && <h2 className="sidebar-header-title">River View ERP</h2>}
          <button className="collapse-btn" onClick={() => setCollapsed(c => !c)}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        <nav className="sidebar-nav">

          <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <LayoutDashboard size={16} />{!collapsed && <span>Dashboard</span>}
          </NavLink>

          <NavLabel label="Daily Work" collapsed={collapsed} />

          <NavLink to="/billing" className={() => `nav-item ${path.startsWith('/billing') ? 'active' : ''}`}>
            <CreditCard size={16} />{!collapsed && <span>Billing</span>}
          </NavLink>

          <NavLink to="/expenditures" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Wallet size={16} />{!collapsed && <span>Record Expense</span>}
          </NavLink>

          <NavLabel label="Reports & Records" collapsed={collapsed} />

          <NavLink to="/cashbook" className={() => `nav-item ${path === '/cashbook' ? 'active' : ''}`}>
            <BookOpen size={16} />{!collapsed && <span>Cash Book</span>}
          </NavLink>

          <NavLink to="/cash-to-bank" className={() => `nav-item ${path === '/cash-to-bank' ? 'active' : ''}`}>
            <Landmark size={16} />{!collapsed && <span>Cash to Bank</span>}
          </NavLink>

          <NavLink to="/ledger" className={() => `nav-item ${path === '/ledger' ? 'active' : ''}`}>
            <BookMarked size={16} />{!collapsed && <span>Ledger</span>}
          </NavLink>

          <NavLink to="/journal" className={() => `nav-item ${path === '/journal' ? 'active' : ''}`}>
            <ScrollText size={16} />{!collapsed && <span>Journal Entries</span>}
          </NavLink>

          <NavLink to="/reports" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <BarChart3 size={16} />{!collapsed && <span>Reports</span>}
          </NavLink>

          <NavLabel label="Society Registry" collapsed={collapsed} />

          <NavLink to="/plots" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Map size={16} />{!collapsed && <span>Plots</span>}
          </NavLink>

          <NavLink to="/members" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Users size={16} />{!collapsed && <span>Members</span>}
          </NavLink>

          <NavLink to="/tenants" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <UserCheck size={16} />{!collapsed && <span>Tenants</span>}
          </NavLink>

          <NavLabel label="System" collapsed={collapsed} />

          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Settings size={16} />{!collapsed && <span>Settings</span>}
          </NavLink>
          {showImportDataNav && (
            <NavLink to="/import" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <FileUp size={16} />{!collapsed && <span>Import Data</span>}
            </NavLink>
          )}

        </nav>

        <div className="sidebar-footer">
          <div className="zoom-controls">
            {!collapsed && <span className="zoom-label">Zoom {zoomLevel}%</span>}
            <div className="zoom-actions">
              <button className="zoom-btn" onClick={() => changeZoom(-10)} title="Zoom out">A-</button>
              <button className="zoom-btn" onClick={() => setZoomLevel(100)} title="Reset zoom">100%</button>
              <button className="zoom-btn" onClick={() => changeZoom(10)} title="Zoom in">A+</button>
            </div>
          </div>

          {!collapsed && (
            <div className="sidebar-user">
              <div className="sidebar-avatar">
                {user.display_name?.[0]?.toUpperCase() || 'A'}
              </div>
              <span className="sidebar-user-name">{user.display_name || 'Admin'}</span>
            </div>
          )}
          <button className="nav-item" style={{ color: 'var(--c-overdue)', opacity: 0.8 }}
            onClick={handleLogout} title="Logout">
            <LogOut size={16} />{!collapsed && <span>Logout</span>}
          </button>
        </div>

      </aside>

      {collapsed && (
        <button
          className="sidebar-reopen-btn"
          onClick={() => setCollapsed(false)}
          title="Open sidebar"
          aria-label="Open sidebar"
        >
          <ChevronRight size={16} />
        </button>
      )}

      <main className="main-content">
        <Suspense fallback={<div className="page">Loading...</div>}>
          <Routes>
            <Route path="/" element={<DashboardPage user={user} />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/billing/*" element={<BillingPage />} />
            <Route path="/special-bills" element={<Navigate to="/billing?tab=special" replace />} />
            <Route path="/expenditures" element={<ExpenditurePage />} />
            <Route path="/cashbook" element={<CashBookPage />} />
            <Route path="/cash-to-bank" element={<CashToBankPage />} />
            <Route path="/ledger" element={<AccountLedgerPage />} />
            <Route path="/journal" element={<JournalEntriesPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/plots" element={<PlotsPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/tenants" element={<TenantsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/import" element={<ImportPage />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}
