import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { desc, eq, gte, lte, and, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { sensorReadings, alerts } from '../db/schema.js';
import type { SensorReading, Alert } from '../types/index.js';

const periodMap: Record<string, number> = {
  '24h': 24,
  '7d':  24 * 7,
  '30d': 24 * 30,
};

const SENSOR_PARAMS = [
  'ph', 'water_temperature', 'dissolved_oxygen',
  'turbidity_ntu', 'ec_us_cm', 'tds_ppm', 'orp_mv',
] as const;

function toIso(val: unknown): string {
  return val instanceof Date ? val.toISOString() : String(val);
}

function rowToReading(row: typeof sensorReadings.$inferSelect): SensorReading {
  return {
    id:                row.id,
    device_id:         row.device_id,
    recorded_at:       toIso(row.recorded_at),
    ph:                row.ph ?? null,
    water_temperature: row.water_temperature ?? null,
    dissolved_oxygen:  row.dissolved_oxygen ?? null,
    turbidity_ntu:     row.turbidity_ntu ?? null,
    ec_us_cm:          row.ec_us_cm ?? null,
    tds_ppm:           row.tds_ppm ?? null,
    orp_mv:            row.orp_mv ?? null,
  };
}

const readingsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/readings/latest
  fastify.get(
    '/api/readings/latest',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const querySchema = z.object({
        device_id: z.string().optional(),
      });
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: parsed.error.errors[0]?.message ?? 'Bad request', code: 'VALIDATION_ERROR' });
      }

      const db = getDb();
      const condition = parsed.data.device_id
        ? eq(sensorReadings.device_id, parsed.data.device_id)
        : undefined;

      const [row] = await db
        .select()
        .from(sensorReadings)
        .where(condition)
        .orderBy(desc(sensorReadings.recorded_at))
        .limit(1);

      if (!row) {
        return reply.status(404).send({
          success: false,
          error: 'No readings found',
          code: 'NOT_FOUND',
        });
      }
      return reply.send({ success: true, data: rowToReading(row) });
    }
  );

  // GET /api/readings/history
  fastify.get(
    '/api/readings/history',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const querySchema = z.object({
        from:      z.string().datetime().optional(),
        to:        z.string().datetime().optional(),
        limit:     z.coerce.number().int().min(1).max(10000).default(100),
        device_id: z.string().optional(),
      });

      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors.map((e) => e.message).join(', '),
          code: 'VALIDATION_ERROR',
        });
      }

      const { from, to, limit, device_id } = parsed.data;
      const db = getDb();

      const conditions = [];
      if (from)      conditions.push(gte(sensorReadings.recorded_at, new Date(from)));
      if (to)        conditions.push(lte(sensorReadings.recorded_at, new Date(to)));
      if (device_id) conditions.push(eq(sensorReadings.device_id, device_id));

      const rows = await db
        .select()
        .from(sensorReadings)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(sensorReadings.recorded_at))
        .limit(limit);

      return reply.send({
        success: true,
        data: rows.map(rowToReading),
        count: rows.length,
      });
    }
  );

  // GET /api/readings/stats
  fastify.get(
    '/api/readings/stats',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const querySchema = z.object({
        period: z.enum(['24h', '7d', '30d']).default('24h'),
      });

      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors.map((e) => e.message).join(', '),
          code: 'VALIDATION_ERROR',
        });
      }

      const hours = periodMap[parsed.data.period]!;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      const db = getDb();

      const statsResult = await db
        .select({
          ph_min:  sql<number>`min(ph)`,
          ph_avg:  sql<number>`avg(ph)`,
          ph_max:  sql<number>`max(ph)`,
          water_temperature_min: sql<number>`min(water_temperature)`,
          water_temperature_avg: sql<number>`avg(water_temperature)`,
          water_temperature_max: sql<number>`max(water_temperature)`,
          dissolved_oxygen_min: sql<number>`min(dissolved_oxygen)`,
          dissolved_oxygen_avg: sql<number>`avg(dissolved_oxygen)`,
          dissolved_oxygen_max: sql<number>`max(dissolved_oxygen)`,
          turbidity_ntu_min: sql<number>`min(turbidity_ntu)`,
          turbidity_ntu_avg: sql<number>`avg(turbidity_ntu)`,
          turbidity_ntu_max: sql<number>`max(turbidity_ntu)`,
          ec_us_cm_min: sql<number>`min(ec_us_cm)`,
          ec_us_cm_avg: sql<number>`avg(ec_us_cm)`,
          ec_us_cm_max: sql<number>`max(ec_us_cm)`,
          tds_ppm_min: sql<number>`min(tds_ppm)`,
          tds_ppm_avg: sql<number>`avg(tds_ppm)`,
          tds_ppm_max: sql<number>`max(tds_ppm)`,
          orp_mv_min: sql<number>`min(orp_mv)`,
          orp_mv_avg: sql<number>`avg(orp_mv)`,
          orp_mv_max: sql<number>`max(orp_mv)`,
          count: sql<number>`count(*)`,
        })
        .from(sensorReadings)
        .where(gte(sensorReadings.recorded_at, since));

      const raw = statsResult[0];
      const stats: Record<string, { min: number | null; avg: number | null; max: number | null }> = {};

      for (const param of SENSOR_PARAMS) {
        const p = param as string;
        stats[param] = {
          min: (raw as Record<string, number | null>)[`${p}_min`] ?? null,
          avg: (raw as Record<string, number | null>)[`${p}_avg`] ?? null,
          max: (raw as Record<string, number | null>)[`${p}_max`] ?? null,
        };
      }

      return reply.send({
        success: true,
        period: parsed.data.period,
        count: Number(raw?.count ?? 0),
        data: stats,
      });
    }
  );

  // GET /api/readings/export
  fastify.get(
    '/api/readings/export',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const querySchema = z.object({
        from:      z.string().datetime().optional(),
        to:        z.string().datetime().optional(),
        device_id: z.string().optional(),
      });

      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors.map((e) => e.message).join(', '),
          code: 'VALIDATION_ERROR',
        });
      }

      const { from, to, device_id } = parsed.data;
      const db = getDb();
      const conditions = [];
      if (from)      conditions.push(gte(sensorReadings.recorded_at, new Date(from)));
      if (to)        conditions.push(lte(sensorReadings.recorded_at, new Date(to)));
      if (device_id) conditions.push(eq(sensorReadings.device_id, device_id));

      const rows = await db
        .select()
        .from(sensorReadings)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(sensorReadings.recorded_at))
        .limit(100000);

      const headers = [
        'id', 'device_id', 'recorded_at', 'ph', 'water_temperature',
        'dissolved_oxygen', 'turbidity_ntu', 'ec_us_cm', 'tds_ppm', 'orp_mv',
      ];

      const csvLines = [headers.join(',')];
      for (const row of rows) {
        csvLines.push([
          row.id,
          row.device_id,
          toIso(row.recorded_at),
          row.ph ?? '',
          row.water_temperature ?? '',
          row.dissolved_oxygen ?? '',
          row.turbidity_ntu ?? '',
          row.ec_us_cm ?? '',
          row.tds_ppm ?? '',
          row.orp_mv ?? '',
        ].join(','));
      }

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', 'attachment; filename="readings.csv"');
      return reply.send(csvLines.join('\n'));
    }
  );

  // GET /api/alerts
  fastify.get(
    '/api/alerts',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const querySchema = z.object({
        limit:        z.coerce.number().int().min(1).max(500).default(50),
        acknowledged: z.enum(['true', 'false']).optional(),
      });

      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors.map((e) => e.message).join(', '),
          code: 'VALIDATION_ERROR',
        });
      }

      const { limit, acknowledged } = parsed.data;
      const db = getDb();

      const conditions = [];
      if (acknowledged !== undefined) {
        conditions.push(eq(alerts.is_acknowledged, acknowledged === 'true'));
      }

      const rows = await db
        .select()
        .from(alerts)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(alerts.created_at))
        .limit(limit);

      const data: Alert[] = rows.map((row) => ({
        id:              row.id,
        reading_id:      row.reading_id,
        parameter:       row.parameter,
        value:           row.value,
        threshold_min:   row.threshold_min ?? null,
        threshold_max:   row.threshold_max ?? null,
        message:         row.message,
        created_at:      toIso(row.created_at),
        is_acknowledged: row.is_acknowledged,
      }));

      return reply.send({ success: true, data, count: data.length });
    }
  );

  // PATCH /api/alerts/:id/acknowledge
  fastify.patch(
    '/api/alerts/:id/acknowledge',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const [updated] = await db
        .update(alerts)
        .set({ is_acknowledged: true })
        .where(eq(alerts.id, id))
        .returning();

      if (!updated) {
        return reply.status(404).send({
          success: false,
          error: 'Alert not found',
          code: 'NOT_FOUND',
        });
      }

      return reply.send({ success: true, data: { id: updated.id, is_acknowledged: true } });
    }
  );
};

export default readingsRoutes;
