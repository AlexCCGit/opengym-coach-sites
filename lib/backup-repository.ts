import { env } from "cloudflare:workers";
import { ensureAdminSchema } from "./admin-repository";

// Tables included in a full database backup, with their primary key column.
export const BACKUP_TABLES = {
  profile_state: "user_id",
  profile_control: "user_id",
  app_setting: "key",
  profile_activity: "user_id",
} as const;

type TableName = keyof typeof BACKUP_TABLES;
export type DatabaseBackup = {
  format: "d1-backup";
  version: 1;
  app: string;
  exportedAt: string;
  tables: Partial<Record<TableName, Record<string, unknown>[]>>;
};

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export async function dumpDatabase(app = "opengym"): Promise<DatabaseBackup> {
  await ensureAdminSchema();
  const tables: DatabaseBackup["tables"] = {};
  for (const table of Object.keys(BACKUP_TABLES) as TableName[]) {
    const result = await env.DB.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>();
    tables[table] = result.results ?? [];
  }
  return { format: "d1-backup", version: 1, app, exportedAt: new Date().toISOString(), tables };
}

// Upserts every row with bound parameters, so large state_json values never hit SQL statement length limits.
export async function restoreDatabase(backup: DatabaseBackup) {
  if (backup?.format !== "d1-backup" || backup.version !== 1 || typeof backup.tables !== "object") {
    throw new Error("El archivo no es una copia completa válida");
  }
  await ensureAdminSchema();
  const restored: Record<string, number> = {};
  for (const [table, primaryKey] of Object.entries(BACKUP_TABLES) as [TableName, string][]) {
    const rows = backup.tables[table] ?? [];
    const statements = rows.map((row) => {
      const columns = Object.keys(row);
      if (!columns.includes(primaryKey) || !columns.every((column) => IDENTIFIER.test(column))) {
        throw new Error(`Fila no válida en ${table}`);
      }
      const updates = columns.filter((column) => column !== primaryKey).map((column) => `${column} = excluded.${column}`);
      const conflict = updates.length ? `DO UPDATE SET ${updates.join(", ")}` : "DO NOTHING";
      return env.DB.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) ON CONFLICT(${primaryKey}) ${conflict}`)
        .bind(...columns.map((column) => row[column] ?? null));
    });
    for (let index = 0; index < statements.length; index += 50) await env.DB.batch(statements.slice(index, index + 50));
    restored[table] = rows.length;
  }
  return restored;
}
