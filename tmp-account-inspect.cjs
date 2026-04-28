const Database = require('better-sqlite3')

const dbPath = process.argv[2]
const db = new Database(dbPath, { readonly: true })

const accounts = db.prepare(`
  SELECT id, account_code, account_name, account_type, is_active
  FROM accounts
  ORDER BY account_code
`).all()

const chargeMap = db.prepare(`
  SELECT charge_name, account_code
  FROM charge_account_map
  ORDER BY charge_name
`).all()

const specialCharges = db.prepare(`
  SELECT charge_name, base_amount, is_percentage, percentage_value, varies_by_marla
  FROM onetime_charges
  WHERE is_active = 1
  ORDER BY charge_name
`).all()

console.log(JSON.stringify({ accounts, chargeMap, specialCharges }, null, 2))
