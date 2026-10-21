import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const tokens = sqliteTable(
  "tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    token: text("token").notNull(),
    source: text("source").notNull().default("default"),
    packages: text("packages", { mode: "json" })
      .notNull()
      .default({})
      .$type<Record<string, string[]>>(),
    lastSyncedAt: integer("last_synced_at"),
  },
  (table) => [
    index("tokens_token_idx").on(table.token),
    index("tokens_source_idx").on(table.source),
  ],
);

export const packages = sqliteTable(
  "packages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    version: text("version").notNull(),
    composerJson: text("composer_json", { mode: "json" })
      .notNull()
      .$type<Record<string, unknown>>(),
  },
  (table) => [uniqueIndex("packages_name_version_idx").on(table.name, table.version)],
);

export const securityAdvisories = sqliteTable(
  "security_advisories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    packageName: text("package_name").notNull(),
    advisoryId: text("advisory_id").notNull(),
    affectedVersions: text("affected_versions").notNull(),
    title: text("title").notNull(),
    reportedAt: text("reported_at").notNull(),
    sources: text("sources", { mode: "json" })
      .notNull()
      .$type<Array<{ name: string; remoteId: string }>>(),
    cve: text("cve"),
    link: text("link"),
    severity: text("severity"),
  },
  (table) => [
    uniqueIndex("security_advisories_package_advisory_idx").on(table.packageName, table.advisoryId),
  ],
);
