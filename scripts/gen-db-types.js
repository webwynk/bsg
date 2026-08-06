// Generates src/lib/database.types.ts from the LIVE schema.
// Purpose: make a query against a column that does not exist a COMPILE error.
// Findings S-1 (profiles.status) and S-4 (profiles.parent_agent_id) both reached
// production because supabase-js returns { data: null, error } instead of
// throwing, so a bad column name degraded silently into a fallback.
const { Client } = require('pg');
const fs = require('fs');

const c = new Client({ connectionString: process.env.PG_URL, ssl: { rejectUnauthorized: false } });

// Mirrors the mapping used by `supabase gen types typescript`.
function tsType(dataType, udt) {
  switch (dataType) {
    case 'uuid': case 'text': case 'character varying': case 'character':
    case 'timestamp with time zone': case 'timestamp without time zone':
    case 'date': case 'time without time zone':
      return 'string';
    case 'bigint': case 'integer': case 'smallint': case 'numeric':
    case 'real': case 'double precision':
      return 'number';
    case 'boolean': return 'boolean';
    case 'jsonb': case 'json': return 'Json';
    case 'ARRAY': return 'unknown[]';
    default: return 'unknown';
  }
}

async function run() {
  await c.connect();

  const cols = await c.query(`
    SELECT c.table_name, c.column_name, c.data_type, c.udt_name,
           c.is_nullable, c.column_default,
           (c.is_generated = 'ALWAYS') AS generated
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.ordinal_position`);

  const fns = await c.query(`
    SELECT p.proname,
           pg_get_function_arguments(p.oid) AS args,
           pg_get_function_result(p.oid)    AS result
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
    ORDER BY p.proname`);

  const byTable = {};
  for (const r of cols.rows) (byTable[r.table_name] ??= []).push(r);

  let out = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced from the live schema of project pkwifufxakvwyqjamywo.
 * Regenerate after any migration:
 *     POSTGRES_URL=... node scripts/gen-db-types.js
 *
 * WHY THIS EXISTS
 *   supabase-js returns { data: null, error } rather than throwing, so a query
 *   naming a column that does not exist fails silently and the calling code
 *   slides into whatever fallback it has. Two production defects came from
 *   exactly that: .select('role, status') and .or('...parent_agent_id...'),
 *   neither of which existed. Typing the client against this file turns both
 *   into compile errors.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
`;

  for (const [table, columns] of Object.entries(byTable)) {
    const row = columns.map(col => {
      const t = tsType(col.data_type, col.udt_name);
      const nullable = col.is_nullable === 'YES' ? ' | null' : '';
      return `          ${col.column_name}: ${t}${nullable}`;
    }).join('\n');

    const insert = columns.map(col => {
      const t = tsType(col.data_type, col.udt_name);
      const nullable = col.is_nullable === 'YES' ? ' | null' : '';
      // Optional when it has a default or is nullable.
      const optional = (col.column_default !== null || col.is_nullable === 'YES') ? '?' : '';
      return `          ${col.column_name}${optional}: ${t}${nullable}`;
    }).join('\n');

    const update = columns.map(col => {
      const t = tsType(col.data_type, col.udt_name);
      const nullable = col.is_nullable === 'YES' ? ' | null' : '';
      return `          ${col.column_name}?: ${t}${nullable}`;
    }).join('\n');

    out += `      ${table}: {
        Row: {
${row}
        }
        Insert: {
${insert}
        }
        Update: {
${update}
        }
        Relationships: []
      }
`;
  }

  out += `    }
    Views: Record<string, never>
    Functions: {
`;

  for (const f of fns.rows) {
    // Args are typed loosely: the RPC surface returns jsonb and the call sites
    // validate their own shapes. The value here is that the function NAME is
    // checked, so a renamed RPC fails to compile.
    out += `      ${f.proname}: {
        Args: Record<string, unknown>
        Returns: Json
      }
`;
  }

  out += `    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
`;

  fs.writeFileSync('src/lib/database.types.ts', out);
  console.log(`Wrote src/lib/database.types.ts`);
  console.log(`  tables:    ${Object.keys(byTable).join(', ')}`);
  console.log(`  functions: ${fns.rowCount}`);
  await c.end();
}
run().catch(e => { console.error('FAILED', e.message); process.exit(1); });
