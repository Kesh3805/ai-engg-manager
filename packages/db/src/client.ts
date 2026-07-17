import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

/**
 * Postgres client. DATABASE_URL is required — there is no mock fallback. Every
 * consumer of this package (queue workers, Kafka apps, the seed CLI) runs
 * against live infrastructure.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

export const sqlClient = postgres(connectionString, { max: 10, prepare: false });

export const db = drizzle(sqlClient, { schema });

export { schema };
