import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { OpeningHoursJson } from "../shared/types.js";

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull()
});

export const places = sqliteTable(
  "places",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    externalId: text("external_id").notNull().unique(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    address: text("address"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    openingHoursText: text("opening_hours_text"),
    openingHoursJson: text("opening_hours_json", { mode: "json" }).$type<OpeningHoursJson | null>(),
    source: text("source"),
    sourceUrl: text("source_url"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`)
  },
  (table) => ({
    latLonIdx: index("idx_places_lat_lon").on(table.latitude, table.longitude),
    activeIdx: index("idx_places_active").on(table.isActive)
  })
);

export const placeCategories = sqliteTable(
  "place_categories",
  {
    placeId: integer("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false)
  },
  (table) => ({
    pk: primaryKey({ columns: [table.placeId, table.categoryId] }),
    categoryIdx: index("idx_place_categories_category_id").on(table.categoryId),
    onePrimaryIdx: uniqueIndex("idx_place_categories_one_primary")
      .on(table.placeId)
      .where(sql`${table.isPrimary} = 1`)
  })
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Place = typeof places.$inferSelect;
export type NewPlace = typeof places.$inferInsert;
export type PlaceCategory = typeof placeCategories.$inferSelect;
export type NewPlaceCategory = typeof placeCategories.$inferInsert;
