const { Client } = require('pg');

const fs = require('fs');
const path = require('path');

let connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  try {
    const envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
    const match = envContent.match(/POSTGRES_URL="?([^"\r\n]+)"?/);
    if (match) connectionString = match[1];
  } catch (e) {}
}

const c = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await c.connect();
  console.log('Connected to live production database.');

  // 1. Tables
  const tables = await c.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  console.log(`\n--- Tables (${tables.rows.length}) ---`);
  tables.rows.forEach(r => console.log(' ', r.table_name));

  // 2. Custom Types / Enums
  const types = await c.query(`
    SELECT t.typname 
    FROM pg_type t 
    JOIN pg_namespace n ON n.oid = t.typnamespace 
    WHERE n.nspname = 'public' AND t.typtype = 'e'
    ORDER BY t.typname
  `);
  console.log(`\n--- Enums (${types.rows.length}) ---`);
  types.rows.forEach(r => console.log(' ', r.typname));

  // 3. Functions
  const fns = await c.query(`
    SELECT p.proname, pg_get_function_arguments(p.oid) as args
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
    ORDER BY p.proname
  `);
  console.log(`\n--- Functions (${fns.rows.length}) ---`);
  fns.rows.forEach(r => console.log(`  ${r.proname}(${r.args})`));

  // 4. RLS Policies
  const policies = await c.query(`
    SELECT schemaname, tablename, policyname, permissive, roles, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `);
  console.log(`\n--- RLS Policies (${policies.rows.length}) ---`);
  policies.rows.forEach(r => console.log(`  [${r.tablename}] ${r.policyname} (${r.cmd})`));

  // 5. Triggers (all schemas)
  const triggers = await c.query(`
    SELECT event_object_schema, event_object_table, trigger_name, action_timing, event_manipulation
    FROM information_schema.triggers
    WHERE event_object_schema IN ('public', 'auth')
    ORDER BY event_object_schema, event_object_table, trigger_name
  `);
  console.log(`\n--- Triggers (${triggers.rows.length}) ---`);
  triggers.rows.forEach(r => console.log(`  [${r.event_object_schema}.${r.event_object_table}] ${r.trigger_name} (${r.action_timing} ${r.event_manipulation})`));

  // 7. Table row counts
  console.log('\n--- Row Counts ---');
  for (const r of tables.rows) {
    const cnt = await c.query(`SELECT count(*)::text as cnt FROM public.${r.table_name}`);
    console.log(`  ${r.table_name}: ${cnt.rows[0].cnt}`);
  }
  const ucnt = await c.query(`SELECT count(*)::text as cnt FROM auth.users`);
  console.log(`  auth.users: ${ucnt.rows[0].cnt}`);

  // 8. Cron jobs
  try {
    const jobs = await c.query(`SELECT jobid, schedule, command, active FROM cron.job`);
    console.log(`\n--- Cron Jobs (${jobs.rows.length}) ---`);
    jobs.rows.forEach(j => console.log(`  [job ${j.jobid}] active=${j.active} schedule='${j.schedule}' command=${j.command}`));
  } catch (err) {
    console.log(`\n--- Cron Jobs: ${err.message} ---`);
  }

  // 9. Latest Round
  try {
    const lr = await c.query(`SELECT * FROM public.rounds ORDER BY round_number DESC LIMIT 1`);
    if (lr.rows.length > 0) {
      console.log(`\n--- Latest Round: #${lr.rows[0].round_number} ---`);
      console.log(' ', Object.keys(lr.rows[0]).map(k => `${k}=${lr.rows[0][k]}`).join(', '));
    }
  } catch (err) {
    console.log(`\n--- Latest Round error: ${err.message} ---`);
  }

  await c.end();
}

main().catch(err => {
  console.error('Inspection failed:', err);
  process.exit(1);
});
