import { Pool } from "pg";
import { config } from "./config";

// Reuse one pool across Next.js hot reloads.
const g = globalThis as unknown as { __jobHunterPool?: Pool };

export const pool: Pool = g.__jobHunterPool ?? new Pool({ connectionString: config.databaseUrl });
g.__jobHunterPool = pool;
