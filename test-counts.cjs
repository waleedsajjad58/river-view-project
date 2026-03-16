const Database = require('better-sqlite3')
const path = require('path')

const dbPath = path.join(process.env.APPDATA, 'clean-app---template-react', 'database', 'riverview_erp.db')
const db = new Database(dbPath)

console.log('=== Row counts ===')
console.log('bill_templates:', db.prepare('SELECT COUNT(*) as c FROM bill_templates').get().c)
console.log('onetime_charges:', db.prepare('SELECT COUNT(*) as c FROM onetime_charges').get().c)
console.log('settings:', db.prepare('SELECT COUNT(*) as c FROM settings').get().c)
console.log('users:', db.prepare('SELECT COUNT(*) as c FROM users').get().c)
console.log('schema_version:', db.prepare("SELECT value FROM settings WHERE key='schema_version'").get().value)
db.close()
