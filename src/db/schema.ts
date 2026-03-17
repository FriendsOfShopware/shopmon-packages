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

export const customPackages = sqliteTable(
  "custom_packages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tokenId: integer("token_id").notNull(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    composerJson: text("composer_json", { mode: "json" })
      .notNull()
      .$type<Record<string, unknown>>(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("custom_packages_token_name_version_idx").on(
      table.tokenId,
      table.name,
      table.version,
    ),
    index("custom_packages_token_id_idx").on(table.tokenId),
  ],
);
