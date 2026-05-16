import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  doublePrecision,
  boolean,
  text,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
import { sql } from 'drizzle-orm';

export const sensorReadings = pgTable('sensor_readings', {
  id:                uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  device_id:         varchar('device_id', { length: 255 }).notNull().references(() => devices.device_id),
  recorded_at:       timestamptz('recorded_at').notNull().default(sql`now()`),
  ph:                doublePrecision('ph'),
  water_temperature: doublePrecision('water_temperature'),
  dissolved_oxygen:  doublePrecision('dissolved_oxygen'),
  turbidity_ntu:     doublePrecision('turbidity_ntu'),
  ec_us_cm:          doublePrecision('ec_us_cm'),
  tds_ppm:           doublePrecision('tds_ppm'),
  orp_mv:            doublePrecision('orp_mv'),
});

export const alerts = pgTable('alerts', {
  id:              uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  reading_id:      uuid('reading_id').notNull().references(() => sensorReadings.id),
  parameter:       varchar('parameter', { length: 100 }).notNull(),
  value:           doublePrecision('value').notNull(),
  threshold_min:   doublePrecision('threshold_min'),
  threshold_max:   doublePrecision('threshold_max'),
  message:         text('message').notNull(),
  created_at:      timestamptz('created_at').notNull().default(sql`now()`),
  is_acknowledged: boolean('is_acknowledged').notNull().default(false),
});

export const users = pgTable('users', {
  id:            uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email:         varchar('email', { length: 255 }).notNull().unique(),
  password_hash: varchar('password_hash', { length: 255 }).notNull(),
  created_at:    timestamptz('created_at').notNull().default(sql`now()`),
});

export const devices = pgTable('devices', {
  id:           uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  device_id:    varchar('device_id', { length: 255 }).notNull().unique(),
  name:         varchar('name', { length: 255 }).notNull(),
  location:     varchar('location', { length: 500 }).notNull().default(''),
  secret_hash:  varchar('secret_hash', { length: 255 }).notNull(),
  is_active:    boolean('is_active').notNull().default(true),
  last_seen_at: timestamptz('last_seen_at'),
  created_at:   timestamptz('created_at').notNull().default(sql`now()`),
});
