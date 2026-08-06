#!/usr/bin/env node
/**
 * Applies ONE migration file to the database, inside a transaction.
 *
 * Usage:
 *   POSTGRES_URL="postgresql://..." node apply_sql_to_live_db.js supabase/migrations/<file>.sql
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCRIPT WAS REWRITTEN (findings A-6 and N-0)
 *
 * The previous version:
 *   1. Hard-coded the production Postgres superuser password in this file,
 *      which is NOT covered by .gitignore (it only excludes .env*). Rotate that
 *      credential if it has ever been committed or shared.
 *   2. Always executed supabase/migrations/20260728050000_bsg_fresh_setup.sql,
 *      a full-rebuild script that opens with DROP TABLE ... CASCADE on five
 *      tables — including profiles, transactions and every round and bet.
 *   3. Ran outside a transaction, so a partial failure left a half-migrated
 *      schema behind.
 *
 * That baseline file is also STALE: production has since been patched directly
 * and now differs from it (see N-0 in CROSS_SYSTEM_MISMATCHES.md — the live
 * submit_round_bet is a single text-signature function carrying P0009/P0010
 * guards the file does not have). Re-running it would have destroyed live data
 * AND reverted those guards.
 *
 * This version takes the migration path as an argument, refuses destructive
 * statements, reads credentials from the environment, and wraps the whole
 * migration in a single transaction.
 * ---------------------------------------------------------------------------
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
const connectionString = process.env.POSTGRES_URL || process.env.PG_URL;

if (!file) {
  console.error('Usage: POSTGRES_URL=... node apply_sql_to_live_db.js <path-to-migration.sql>');
  process.exit(1);
}
if (!connectionString) {
  console.error('Refusing to run: set POSTGRES_URL (or PG_URL) in the environment.');
  console.error('Never hard-code the database password in this file.');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`Migration not found: ${file}`);
  process.exit(1);
}

const sql = fs.readFileSync(file, 'utf8');

// Guard against the class of accident that made the old script dangerous.
const DESTRUCTIVE = /\b(DROP\s+TABLE|DROP\s+SCHEMA|TRUNCATE|DELETE\s+FROM)\b/i;
if (DESTRUCTIVE.test(sql)) {
  console.error('REFUSED: this file contains DROP TABLE / DROP SCHEMA / TRUNCATE / DELETE FROM.');
  console.error('Apply destructive changes deliberately and with a verified backup in hand.');
  process.exit(1);
}

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();
  console.log(`Applying ${path.basename(file)} (${sql.length} bytes) in a transaction...`);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ Committed.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Rolled back — no changes applied.');
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
