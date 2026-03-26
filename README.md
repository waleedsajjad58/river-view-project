# River View Housing Society ERP

A comprehensive, offline-first Desktop Application built specifically for managing the operations, billing, and accounting of the River View Housing Society. 

Built with **Electron**, **React**, **Vite**, and **SQLite**.

---

## 🌟 Current Progress (As of Phase 6)

The application has been successfully built up to Phase 5, with Phase 6 currently in progress. The core business logic, database integrity, and UI framework are fully operational.

### ✅ Completed Features

**1. Foundation & Architecture**
- Unified Electron-Vite build system for raw performance and stable `.exe` compilation.
- Local, offline SQLite database (`better-sqlite3`) for absolute privacy and speed.
- Double-entry accounting engine baked into the core handling all financial transactions.

**2. Plot & Member Management**
- Complete CRUD operations for Plots (Residential, Commercial, Amenities).
- Member/Owner profiles with historical logging.
- Plot-to-Owner assignment and transfer history.

**3. Billing Engine**
- Automated Monthly Bill generation based on templates.
- Support for special/ad-hoc bills.
- Built-in Late Fee calculation and penalty application.
- Printable PDF Challan generation for members to pay at banks.

**4. Financial Ledgers (Chart of Accounts)**
- Standardized Chart of Accounts (Assets, Liabilities, Equity, Revenue, Expenses).
- Cash & Bank Book that perfectly mirrors physical paper ledgers.
- Manual Journal Entry interface for specialized accounting adjustments.
- Automated double-entry posting whenever a bill is generated or a payment is received.

**5. Reports & Analytics**
- **Trial Balance:** Live, real-time calculation of all debits and credits to ensure books are perfectly balanced.
- **Defaulter Report:** Color-coded severity ranking of unpaid bills with aging analysis (30/90/180+ days overdue).
- **Collection Summary:** Month-by-month breakdown of cash vs. bank revenue.
- **Income & Expenditure Statement:** Dynamic P&L based on accounting ledgers.
- Native CSV export for all reports to easily open in Excel.

### 🚧 In Progress (Phase 6)
- **Settings & System:** UI currently built for triggering manual database backups and exporting master lists (Plots, Members, Bills) to CSV.
- **To be completed next session:** Automatic scheduled backups, Excel import utility for onboarding initial plot records, and finalizing `.exe` app packaging.

---

## 🚀 How to Run the App (Development)

Ensure you have **Node.js (v18+)** installed.

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Launch the Application:**
   ```bash
   npm run dev
   ```
   *Note: If you run into Electron initialization errors in your IDE terminals (like VS Code or Cursor), ensure the `ELECTRON_RUN_AS_NODE` environment variable is cleared. Our build scripts and source code automatically handle this.*

3. **Build the Final Executable (Pending finalization):**
   ```bash
   npm run build
   ```

---

## 🛠️ How it Works

1. **The Architecture:** 
   We use `electron-vite` which splits the app into `main` (Node.js/Electron backend), `preload` (Secure IPC bridge), and `renderer` (React UI).
   
2. **The Database:**
   We use `better-sqlite3` which runs synchronously on the `main` process. It is blazing fast and stores all data locally in the user's `AppData` folder. If there is no internet, the app works perfectly.

3. **Secure Communication (IPC):**
   The React frontend never speaks directly to the database. Instead, it calls functions on `window.ipcRenderer`. These ping the `main` process which executes the SQL and returns the data securely.

4. **Accounting Engine:**
   When you receive a payment from a member, you don't just update an "is_paid" flag. The backend *automatically* creates a Journal Entry: crediting Accounts Receivable (or the member's account) and debiting Cash/Bank. This ensures financial auditors can track every single rupee.

---

## 📝 Next Steps for the Following Session
1. Test the CSV exporting and Backup routines inside the compiled `.exe` environment.
2. Complete the initial data ingestion tool (Import Plots/Members from Excel).
3. Test and finalize the Windows installer generation using `electron-builder`.
