require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')

async function main() {
  const client = new Client({ connectionString: process.env.POSTGRES_URL })
  await client.connect()

  console.log('=== Current active_sessions for staff ===')
  const rows = await client.query(`
    SELECT s.user_id, p.username, p.role, s.session_token, s.last_seen_at, s.created_at,
           EXTRACT(EPOCH FROM (NOW() - s.last_seen_at))::INT AS seconds_since_seen
    FROM public.active_sessions s
    JOIN public.profiles p ON p.id = s.user_id
    WHERE p.role IN ('agent','superadmin')
    ORDER BY s.last_seen_at DESC;
  `)
  console.table(rows.rows)

  console.log('=== Current grace period config ===')
  const gc = await client.query(`SELECT staff_session_grace_sec FROM public.game_config WHERE id='global'`)
  console.table(gc.rows)

  console.log('=== Current server time (for comparison against last_seen_at above) ===')
  const now = await client.query(`SELECT NOW() AS db_now`)
  console.table(now.rows)

  await client.end()
}

main().catch(e => { console.error(e); process.exit(1) })
