import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/index.js';
import { sensorReadings, devices } from '../db/schema.js';
import { processAlerts } from '../services/alert.js';
import type { SensorReading } from '../types/index.js';

const ingestBody = z.object({
  device_id:         z.string().min(1),
  secret:            z.string().min(1),
  ph:                z.number().optional(),
  water_temperature: z.number().optional(),
  dissolved_oxygen:  z.number().optional(),
  turbidity_ntu:     z.number().optional(),
  ec_us_cm:          z.number().optional(),
  tds_ppm:           z.number().optional(),
  orp_mv:            z.number().optional(),
  recorded_at:       z.string().datetime().optional(),
});

const sensorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/api/sensor/ingest',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const parsed = ingestBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors.map((e) => e.message).join(', '),
          code: 'VALIDATION_ERROR',
        });
      }

      const { secret, device_id, recorded_at, ...sensorData } = parsed.data;

      const db = getDb();

      // Look up device in DB for per-device secret check
      const [deviceRow] = await db
        .select()
        .from(devices)
        .where(eq(devices.device_id, device_id))
        .limit(1);

      if (!deviceRow) {
        return reply.status(401).send({
          success: false,
          error: 'Device tidak terdaftar. Daftarkan perangkat terlebih dahulu di halaman Devices.',
          code: 'DEVICE_NOT_REGISTERED',
        });
      }

      if (!deviceRow.is_active) {
        return reply.status(401).send({
          success: false,
          error: 'Device dinonaktifkan. Aktifkan kembali di halaman Devices.',
          code: 'DEVICE_INACTIVE',
        });
      }

      const authenticated = await bcrypt.compare(secret, deviceRow.secret_hash);
      if (!authenticated) {
        return reply.status(401).send({
          success: false,
          error: 'Invalid device secret',
          code: 'INVALID_SECRET',
        });
      }

      // Update last_seen_at — fire-and-forget, must not delay ingest response
      if (deviceRow) {
        db.update(devices)
          .set({ last_seen_at: new Date() })
          .where(eq(devices.device_id, device_id))
          .execute()
          .catch((err) => fastify.log.warn({ err }, 'Failed to update last_seen_at'));
      }

      const [row] = await db
        .insert(sensorReadings)
        .values({
          device_id,
          recorded_at: recorded_at ? new Date(recorded_at) : new Date(),
          ...sensorData,
        })
        .returning();

      const reading: SensorReading = {
        id:                row!.id,
        device_id:         row!.device_id,
        recorded_at:       row!.recorded_at instanceof Date
                             ? row!.recorded_at.toISOString()
                             : String(row!.recorded_at),
        ph:                row!.ph ?? null,
        water_temperature: row!.water_temperature ?? null,
        dissolved_oxygen:  row!.dissolved_oxygen ?? null,
        turbidity_ntu:     row!.turbidity_ntu ?? null,
        ec_us_cm:          row!.ec_us_cm ?? null,
        tds_ppm:           row!.tds_ppm ?? null,
        orp_mv:            row!.orp_mv ?? null,
      };

      const generatedAlerts = await processAlerts(reading, (alert) => {
        fastify.emitAlert(alert);
      });

      fastify.emitSensorUpdate({ reading, alerts: generatedAlerts });

      return reply.send({
        success: true,
        reading_id: reading.id,
        alerts_generated: generatedAlerts.length,
      });
    }
  );
};

export default sensorRoutes;
