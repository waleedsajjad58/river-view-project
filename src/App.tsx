import { useState } from 'react'
import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, CreditCard, BookOpen, Settings,
  ChevronLeft, ChevronRight, BarChart3,
  LogOut, Users, Map, Wallet, ScrollText, BookMarked, FileUp, UserCheck, Landmark
} from 'lucide-react'

import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ImportPage from './pages/ImportPage'
import BillingPage from './pages/BillingPage'
import ExpenditurePage from './pages/ExpenditurePage'
import CashBookPage from './pages/CashBookPage'
import CashToBankPage from './pages/CashToBankPage'
import AccountLedgerPage from './pages/AccountLedgerPage'
import JournalEntriesPage from './pages/JournalEntriesPage'
import ReportsPage from './pages/ReportsPage'
import PlotsPage from './pages/PlotsPage'
import MembersPage from './pages/MembersPage'
import TenantsPage from './pages/TenantsPage'
import SettingsPage from './pages/SettingsPage'

function NavLabel({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) return <div style={{ height: '0.75rem' }} />
  return <div className="nav-section-label">{label}</div>
}

export default function App() {
  const [user, setUser] = useState<any>(null)
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const path = location.pathname

  if (!user) return <LoginPage onLogin={setUser} />

  return (
    <div className="app-container">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>

        <div className="sidebar-header">
          <div className="logo">RV</div>
          {!collapsed && <h2>River View ERP</h2>}
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
          <NavLink to="/import" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <FileUp size={16} />{!collapsed && <span>Import Data</span>}
          </NavLink>

        </nav>

        <div className="sidebar-footer">
          {!collapsed && (
            <div className="sidebar-user">
              <div className="sidebar-avatar">
                {user.display_name?.[0]?.toUpperCase() || 'A'}
              </div>
              <span className="sidebar-user-name">{user.display_name || 'Admin'}</span>
            </div>
          )}
          <button className="nav-item" style={{ color: 'var(--c-overdue)', opacity: 0.8 }}
            onClick={() => setUser(null)} title="Logout">
            <LogOut size={16} />{!collapsed && <span>Logout</span>}
          </button>
        </div>

      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardPage user={user} />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/billing/*" element={<BillingPage />} />
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
      </main>
    </div>
  )
}
