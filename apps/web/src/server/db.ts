import 'server-only';
import postgres from 'postgres';

const globalForDb = globalThis as unknown as { __sql?: postgres.Sql };

function init(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for live mode');
  return postgres(url, { max: 8, prepare: false, idle_timeout: 20, connect_timeout: 8 });
}

export const sql: postgres.Sql = globalForDb.__sql ?? (globalForDb.__sql = init());
