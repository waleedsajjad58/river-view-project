import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';

// Placeholder Pages
const Dashboard = () => <div className="p-8"><h1>Dashboard</h1><p>Welcome to River View ERP</p></div>;
const Plots = () => <div className="p-8"><h1>Plots Registry</h1></div>;
const Members = () => <div className="p-8"><h1>Members</h1></div>;
const Billing = () => <div className="p-8"><h1>Billing Center</h1></div>;
const Ledger = () => <div className="p-8"><h1>Financial Ledger</h1></div>;

export default function App() {
    return (
        <div className="app-container">
            <Sidebar />
            <main className="main-content">
                <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/plots" element={<Plots />} />
                    <Route path="/members" element={<Members />} />
                    <Route path="/billing" element={<Billing />} />
                    <Route path="/ledger" element={<Ledger />} />
                </Routes>
            </main>
        </div>
    );
}
