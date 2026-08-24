import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const profileState = sqliteTable("profile_state", {
  userId: text("user_id").primaryKey(),
  stateJson: text("state_json").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});
