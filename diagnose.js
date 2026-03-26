const Database = require('better-sqlite3');
const path = require('path');

// Construct the database path
const userDataPath = path.join(
  process.platform === 'win32' 
    ? (process.env.APPDATA || path.join(process.env.HOMEDRIVE, process.env.HOMEPATH))
    : process.env.HOME,
  'river-view-project'
);
const dbPath = path.join(userDataPath, 'database', 'riverview_erp.db');

console.log('Database path:', dbPath);

try {
  const db = new Database(dbPath);
  
  console.log('\n=== QUERY 1: Bill items for paid bills ===');
  const q1 = db.prepare(`
    SELECT bi.charge_name, bi.amount, b.billing_month, b.bill_type
    FROM bill_items bi
    JOIN bills b ON bi.bill_id = b.id
    JOIN payment_allocations pa ON pa.bill_id = b.id
    ORDER BY b.billing_month, bi.charge_name
  `).all();
  console.table(q1);
  
  console.log('\n=== QUERY 2: Active bill templates ===');
  const q2 = db.prepare(`SELECT * FROM bill_templates WHERE is_active = 1`).all();
  console.table(q2);
  
  db.close();
} catch (e) {
  console.error('Error:', e.message);
  console.error('Stack:', e.stack);
}
