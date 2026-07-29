const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
  connectionString: 'postgresql://postgres.pkwifufxakvwyqjamywo:133223(GamE)@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connected to Live Supabase PostgreSQL DB (pkwifufxakvwyqjamywo)...');

  const migrationFilePath = './supabase/migrations/20260728050000_bsg_fresh_setup.sql';
  const sql = fs.readFileSync(migrationFilePath, 'utf8');

  console.log('Applying full hardened migration SQL to live database...');
  await client.query(sql);
  console.log('✅ Enterprise security migration successfully applied to Live Supabase PostgreSQL DB with 0 errors!');
  await client.end();
}

run().catch(err => {
  console.error('❌ Migration Error:', err);
  process.exit(1);
});
