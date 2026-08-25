import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const profileState = sqliteTable("profile_state", {
  userId: text("user_id").primaryKey(),
  stateJson: text("state_json").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});

export const profileControl = sqliteTable("profile_control", {
  userId: text("user_id").primaryKey(),
  disabled: integer("disabled").notNull().default(0),
  invited: integer("invited").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const appSetting = sqliteTable("app_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const profileActivity = sqliteTable("profile_activity", {
  userId: text("user_id").primaryKey(),
  status: text("status").notNull(),
  routineName: text("routine_name"),
  startedAt: text("started_at"),
  lastSeenAt: text("last_seen_at").notNull(),
});
