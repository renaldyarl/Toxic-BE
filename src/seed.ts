import 'dotenv/config';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';

const MINUTES   = 48 * 60; // 48 hours of data, one reading per minute
const DEVICE_ID = 'ESP32-LAKE-01';

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function generateReading(_i: number) {
  const violate = Math.random() < 0.08;

  const ph = violate && Math.random() < 0.5
    ? rand(5.0, 6.4)
    : clamp(rand(6.8, 8.2), 6.5, 8.5);

  const water_temperature = violate && Math.random() < 0.5
    ? rand(31, 35)
    : clamp(rand(22, 28), 20, 30);

  const dissolved_oxygen = violate && Math.random() < 0.5
    ? rand(1.5, 3.9)
    : rand(5.0, 9.0);

  const turbidity_ntu = violate && Math.random() < 0.5
    ? rand(6, 15)
    : rand(0.5, 4.5);

  const ec_us_cm = violate && Math.random() < 0.5
    ? rand(510, 700)
    : rand(150, 480);

  const tds_ppm = ec_us_cm * 0.65 + rand(-10, 10);

  const orp_mv = violate && Math.random() < 0.5
    ? rand(50, 99)
    : rand(120, 480);

  return { ph, water_temperature, dissolved_oxygen, turbidity_ntu, ec_us_cm, tds_ppm, orp_mv };
}

async function seed() {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');

  const sql = postgres(url);

  // ── Admin user ────────────────────────────────────────────────────────────
  const adminEmail    = process.env['ADMIN_EMAIL']    ?? 'admin@example.com';
  const adminPassword = process.env['ADMIN_PASSWORD'] ?? 'changeme';

  console.log(`Creating admin user: ${adminEmail}`);
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await sql`
    INSERT INTO users (email, password_hash)
    VALUES (${adminEmail}, ${passwordHash})
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
  `;
  console.log('Admin user ready.');

  // ── Seed device ───────────────────────────────────────────────────────────
  // Use a fixed dev secret so the seed is reproducible.
  // In production, rotate the secret via the dashboard after seeding.
  const seedSecret     = process.env['DEVICE_SECRET'] ?? 'seed-dev-secret-change-me';
  const seedSecretHash = await bcrypt.hash(seedSecret, 12);

  console.log(`Upserting seed device: ${DEVICE_ID}`);
  await sql`
    INSERT INTO devices (device_id, name, location, secret_hash, is_active)
    VALUES (
      ${DEVICE_ID},
      'ESP32 Lake Node 01',
      'Danau Galau, Jawa Barat',
      ${seedSecretHash},
      true
    )
    ON CONFLICT (device_id) DO UPDATE SET
      name        = EXCLUDED.name,
      location    = EXCLUDED.location,
      is_active   = true
  `;
  console.log('Seed device ready.');

  // ── Clear old seed data for this device ───────────────────────────────────
  console.log(`Clearing old readings for ${DEVICE_ID}...`);
  await sql`
    DELETE FROM alerts
    WHERE reading_id IN (
      SELECT id FROM sensor_readings WHERE device_id = ${DEVICE_ID}
    )
  `;
  await sql`DELETE FROM sensor_readings WHERE device_id = ${DEVICE_ID}`;
  console.log('Old data cleared.');

  // ── Insert readings ───────────────────────────────────────────────────────
  console.log(`Inserting ${MINUTES} sensor readings (48 hours, 1/min)...`);

  const now       = Date.now();
  const batchSize = 500;
  let inserted    = 0;

  for (let batch = 0; batch < MINUTES; batch += batchSize) {
    const rows = [];
    for (let i = batch; i < Math.min(batch + batchSize, MINUTES); i++) {
      const recorded_at = new Date(now - (MINUTES - i) * 60 * 1000);
      rows.push({ recorded_at, device_id: DEVICE_ID, ...generateReading(i) });
    }

    await sql`
      INSERT INTO sensor_readings
        (device_id, recorded_at, ph, water_temperature, dissolved_oxygen,
         turbidity_ntu, ec_us_cm, tds_ppm, orp_mv)
      VALUES ${sql(rows.map((r) => [
        r.device_id,
        r.recorded_at.toISOString(),
        r.ph,
        r.water_temperature,
        r.dissolved_oxygen,
        r.turbidity_ntu,
        r.ec_us_cm,
        r.tds_ppm,
        r.orp_mv,
      ]))}
    `;

    inserted += rows.length;
    console.log(`  ${inserted}/${MINUTES} readings inserted`);
  }

  // ── Generate alerts ───────────────────────────────────────────────────────
  console.log('Generating alerts for threshold violations...');

  await sql`
    INSERT INTO alerts (reading_id, parameter, value, threshold_min, threshold_max, message)
    SELECT id, 'ph', ph, 6.5, 8.5,
           'pH ' || round(ph::numeric, 2) || ' — di bawah batas minimum 6.5'
    FROM sensor_readings WHERE device_id = ${DEVICE_ID} AND ph IS NOT NULL AND ph < 6.5
  `;
  await sql`
    INSERT INTO alerts (reading_id, parameter, value, threshold_min, threshold_max, message)
    SELECT id, 'ph', ph, 6.5, 8.5,
           'pH ' || round(ph::numeric, 2) || ' — di atas batas maksimum 8.5'
    FROM sensor_readings WHERE device_id = ${DEVICE_ID} AND ph IS NOT NULL AND ph > 8.5
  `;
  await sql`
    INSERT INTO alerts (reading_id, parameter, value, threshold_min, threshold_max, message)
    SELECT id, 'water_temperature', water_temperature, 20, 30,
           'Suhu air ' || round(water_temperature::numeric, 2) || '°C — di atas batas maksimum 30°C'
    FROM sensor_readings WHERE device_id = ${DEVICE_ID} AND water_temperature IS NOT NULL AND water_temperature > 30
  `;
  await sql`
    INSERT INTO alerts (reading_id, parameter, value, threshold_min, threshold_max, message)
    SELECT id, 'dissolved_oxygen', dissolved_oxygen, 4, NULL,
           'DO ' || round(dissolved_oxygen::numeric, 2) || ' mg/L — di bawah batas minimum 4 mg/L'
    FROM sensor_readings WHERE device_id = ${DEVICE_ID} AND dissolved_oxygen IS NOT NULL AND dissolved_oxygen < 4
  `;
  await sql`
    INSERT INTO alerts (reading_id, parameter, value, threshold_min, threshold_max, message)
    SELECT id, 'turbidity_ntu', turbidity_ntu, NULL, 5,
           'Kekeruhan ' || round(turbidity_ntu::numeric, 2) || ' NTU — di atas batas maksimum 5 NTU'
    FROM sensor_readings WHERE device_id = ${DEVICE_ID} AND turbidity_ntu IS NOT NULL AND turbidity_ntu > 5
  `;
  await sql`
    INSERT INTO alerts (reading_id, parameter, value, threshold_min, threshold_max, message)
    SELECT id, 'ec_us_cm', ec_us_cm, NULL, 500,
           'EC ' || round(ec_us_cm::numeric, 2) || ' µS/cm — di atas batas maksimum 500 µS/cm'
    FROM sensor_readings WHERE device_id = ${DEVICE_ID} AND ec_us_cm IS NOT NULL AND ec_us_cm > 500
  `;
  await sql`
    INSERT INTO alerts (reading_id, parameter, value, threshold_min, threshold_max, message)
    SELECT id, 'orp_mv', orp_mv, 100, 500,
           'ORP ' || round(orp_mv::numeric, 2) || ' mV — di bawah batas minimum 100 mV'
    FROM sensor_readings WHERE device_id = ${DEVICE_ID} AND orp_mv IS NOT NULL AND orp_mv < 100
  `;

  const [{ count }] = await sql`SELECT count(*) FROM alerts WHERE reading_id IN (SELECT id FROM sensor_readings WHERE device_id = ${DEVICE_ID})`;
  console.log(`Generated ${count} alerts.`);

  console.log('Seed complete.');
  await sql.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
