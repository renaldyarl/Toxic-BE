import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';

import { loadConfig } from './config.js';
import { checkDbConnection, closeDb } from './db/index.js';
import socketPlugin from './plugins/socket.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import sensorRoutes from './routes/sensor.js';
import readingsRoutes from './routes/readings.js';
import devicesRoutes from './routes/devices.js';

const config = loadConfig();

const fastify = Fastify({
  logger: config.nodeEnv === 'development'
    ? { level: 'info', transport: { target: 'pino-pretty', options: { colorize: true } } }
    : { level: 'info' },
});

async function start() {
  try {
    await fastify.register(cors, {
      origin: config.allowedOrigin,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });

    await fastify.register(rateLimit, {
      global: false,
      max: 200,
      timeWindow: '1 minute',
    });

    await fastify.register(socketPlugin, { allowedOrigin: config.allowedOrigin });
    await fastify.register(authPlugin);

    fastify.setErrorHandler((error, _request, reply) => {
      fastify.log.error(error);
      const statusCode = error.statusCode ?? 500;
      reply.status(statusCode).send({
        success: false,
        error: error.message || 'Internal server error',
        code: error.code || 'INTERNAL_ERROR',
      });
    });

    fastify.get('/health', async (_request, _reply) => {
      const dbOk = await checkDbConnection();
      return {
        status: 'ok',
        db: dbOk ? 'connected' : 'error',
        uptime: process.uptime(),
      };
    });

    await fastify.register(authRoutes);
    await fastify.register(sensorRoutes);
    await fastify.register(readingsRoutes);
    await fastify.register(devicesRoutes);

    await fastify.listen({ port: config.port, host: '0.0.0.0' });
    fastify.log.info(`Server listening on port ${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

const shutdown = async () => {
  await fastify.close();
  await closeDb();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
