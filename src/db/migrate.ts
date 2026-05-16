import 'dotenv/config';
import postgres from 'postgres';

async function migrate() {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');

  const sql = postgres(url);

  console.log('Running migrations...');

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sensor_readings (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id         VARCHAR(255) NOT NULL,
      recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      ph                DOUBLE PRECISION,
      water_temperature DOUBLE PRECISION,
      dissolved_oxygen  DOUBLE PRECISION,
      turbidity_ntu     DOUBLE PRECISION,
      ec_us_cm          DOUBLE PRECISION,
      tds_ppm           DOUBLE PRECISION,
      orp_mv            DOUBLE PRECISION
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_sensor_readings_recorded_at ON sensor_readings (recorded_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sensor_readings_device_id ON sensor_readings (device_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS alerts (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reading_id      UUID NOT NULL REFERENCES sensor_readings(id),
      parameter       VARCHAR(100) NOT NULL,
      value           DOUBLE PRECISION NOT NULL,
      threshold_min   DOUBLE PRECISION,
      threshold_max   DOUBLE PRECISION,
      message         TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      is_acknowledged BOOLEAN NOT NULL DEFAULT false
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_alerts_reading_id ON alerts (reading_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts (created_at DESC)`;

  // Attempt to create TimescaleDB hypertable — silently skip if extension not available
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE`;
    await sql`SELECT create_hypertable('sensor_readings', 'recorded_at', if_not_exists => TRUE)`;
    console.log('TimescaleDB hypertable created for sensor_readings');
  } catch {
    console.log('TimescaleDB not available — using plain PostgreSQL (schema is compatible)');
  }

  await sql`
    CREATE TABLE IF NOT EXISTS devices (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id    VARCHAR(255) NOT NULL UNIQUE,
      name         VARCHAR(255) NOT NULL,
      location     VARCHAR(500) NOT NULL DEFAULT '',
      secret_hash  VARCHAR(255) NOT NULL,
      is_active    BOOLEAN NOT NULL DEFAULT true,
      last_seen_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices (device_id)`;

  // is_active column for existing databases
  await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`;

  // FK: sensor_readings.device_id → devices.device_id (block delete if readings exist)
  // Wrapped in try/catch — may fail on TimescaleDB hypertables or if orphan data exists
  try {
    await sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_sensor_readings_device_id'
        ) THEN
          ALTER TABLE sensor_readings
            ADD CONSTRAINT fk_sensor_readings_device_id
            FOREIGN KEY (device_id) REFERENCES devices(device_id);
        END IF;
      END $$
    `;
    console.log('FK fk_sensor_readings_device_id ensured.');
  } catch {
    console.log('Could not add FK fk_sensor_readings_device_id — orphan data or hypertable restriction. Clean data first if needed.');
  }

  console.log('Migrations complete.');
  await sql.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
