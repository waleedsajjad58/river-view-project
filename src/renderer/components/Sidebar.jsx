import React from 'react';
import { NavLink } from 'react-router-dom';
import {
    Home,
    Map,
    Users,
    FileText,
    BookOpen,
    Settings
} from 'lucide-react';

export default function Sidebar() {
    const navItems = [
        { name: 'Dashboard', icon: Home, path: '/' },
        { name: 'Plots', icon: Map, path: '/plots' },
        { name: 'Members', icon: Users, path: '/members' },
        { name: 'Billing', icon: FileText, path: '/billing' },
        { name: 'Ledger', icon: BookOpen, path: '/ledger' },
    ];

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="logo-placeholder">RV</div>
                <h2>River View ERP</h2>
            </div>

            <nav className="sidebar-nav">
                {navItems.map((item) => (
                    <NavLink
                        key={item.name}
                        to={item.path}
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    >
                        <item.icon size={20} />
                        <span>{item.name}</span>
                    </NavLink>
                ))}
            </nav>

            <div className="sidebar-footer">
                <button className="nav-item">
                    <Settings size={20} />
                    <span>Settings</span>
                </button>
            </div>
        </aside>
    );
}
