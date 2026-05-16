import { randomBytes } from 'crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, asc } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/index.js';
import { devices } from '../db/schema.js';
import type { Device } from '../types/index.js';

function rowToDevice(row: typeof devices.$inferSelect): Device {
  return {
    id:           row.id,
    device_id:    row.device_id,
    name:         row.name,
    location:     row.location,
    is_active:    row.is_active,
    last_seen_at: row.last_seen_at instanceof Date
                    ? row.last_seen_at.toISOString()
                    : row.last_seen_at
                      ? String(row.last_seen_at)
                      : null,
    created_at:   row.created_at instanceof Date
                    ? row.created_at.toISOString()
                    : String(row.created_at),
  };
}

const createBody = z.object({
  device_id: z.string().min(1).max(255).regex(
    /^[a-zA-Z0-9_-]+$/,
    'device_id hanya boleh berisi huruf, angka, tanda hubung, dan garis bawah'
  ),
  name:      z.string().min(1).max(255),
  location:  z.string().max(500).default(''),
});

const updateBody = z.object({
  name:      z.string().min(1).max(255).optional(),
  location:  z.string().max(500).optional(),
  is_active: z.boolean().optional(),
});

const devicesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/devices — list all devices
  fastify.get(
    '/api/devices',
    { preHandler: [fastify.authenticate] },
    async (_request, reply) => {
      const db   = getDb();
      const rows = await db.select().from(devices).orderBy(asc(devices.created_at));
      return reply.send({ success: true, data: rows.map(rowToDevice), count: rows.length });
    }
  );

  // POST /api/devices — register new device
  fastify.post(
    '/api/devices',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = createBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors.map((e) => e.message).join(', '),
          code:  'VALIDATION_ERROR',
        });
      }

      const { device_id, name, location } = parsed.data;
      const plainSecret = randomBytes(32).toString('hex');
      const secret_hash = await bcrypt.hash(plainSecret, 12);

      const db = getDb();
      try {
        const [row] = await db
          .insert(devices)
          .values({ device_id, name, location, secret_hash })
          .returning();

        return reply.status(201).send({
          success: true,
          data:    rowToDevice(row!),
          secret:  plainSecret,
        });
      } catch (err: unknown) {
        if ((err as { code?: string }).code === '23505') {
          return reply.status(409).send({
            success: false,
            error: 'device_id sudah digunakan',
            code:  'DEVICE_ID_CONFLICT',
          });
        }
        throw err;
      }
    }
  );

  // PATCH /api/devices/:id — update name/location
  fastify.patch(
    '/api/devices/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed  = updateBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: parsed.error.errors.map((e) => e.message).join(', '),
          code:  'VALIDATION_ERROR',
        });
      }

      const updates = parsed.data;
      if (!updates.name && updates.location === undefined && updates.is_active === undefined) {
        return reply.status(400).send({
          success: false,
          error: 'Tidak ada field yang diubah',
          code:  'VALIDATION_ERROR',
        });
      }

      const db = getDb();
      const [row] = await db
        .update(devices)
        .set(updates)
        .where(eq(devices.id, id))
        .returning();

      if (!row) {
        return reply.status(404).send({ success: false, error: 'Device tidak ditemukan', code: 'NOT_FOUND' });
      }
      return reply.send({ success: true, data: rowToDevice(row) });
    }
  );

  // DELETE /api/devices/:id — remove device registration
  fastify.delete(
    '/api/devices/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const db      = getDb();
      try {
        const [row] = await db.delete(devices).where(eq(devices.id, id)).returning();
        if (!row) {
          return reply.status(404).send({ success: false, error: 'Device tidak ditemukan', code: 'NOT_FOUND' });
        }
        return reply.send({ success: true });
      } catch (err: unknown) {
        if ((err as { code?: string }).code === '23503') {
          return reply.status(409).send({
            success: false,
            error: 'Device memiliki data pembacaan. Nonaktifkan device daripada menghapusnya agar data historis tetap terjaga.',
            code:  'DEVICE_HAS_READINGS',
          });
        }
        throw err;
      }
    }
  );

  // POST /api/devices/:id/rotate-secret — generate new secret
  fastify.post(
    '/api/devices/:id/rotate-secret',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const plainSecret = randomBytes(32).toString('hex');
      const secret_hash = await bcrypt.hash(plainSecret, 12);

      const db    = getDb();
      const [row] = await db
        .update(devices)
        .set({ secret_hash })
        .where(eq(devices.id, id))
        .returning();

      if (!row) {
        return reply.status(404).send({ success: false, error: 'Device tidak ditemukan', code: 'NOT_FOUND' });
      }
      return reply.send({ success: true, data: rowToDevice(row), secret: plainSecret });
    }
  );
};

export default devicesRoutes;
