import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import type { Alert, SensorUpdatePayload } from '../types/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
    emitSensorUpdate: (payload: SensorUpdatePayload) => void;
    emitAlert: (alert: Alert) => void;
  }
}

const socketPlugin: FastifyPluginAsync<{ allowedOrigin: string }> = async (
  fastify,
  opts
) => {
  const io = new SocketIOServer(fastify.server, {
    cors: {
      origin: opts.allowedOrigin,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    fastify.log.info({ socketId: socket.id }, 'WebSocket client connected');

    socket.on('subscribe', (data: unknown) => {
      fastify.log.info({ socketId: socket.id, data }, 'Client subscribed');
    });

    socket.on('disconnect', () => {
      fastify.log.info({ socketId: socket.id }, 'WebSocket client disconnected');
    });
  });

  fastify.decorate('io', io);

  fastify.decorate('emitSensorUpdate', (payload: SensorUpdatePayload) => {
    io.emit('sensor:update', payload);
  });

  fastify.decorate('emitAlert', (alert: Alert) => {
    io.emit('alert:new', alert);
  });

  fastify.addHook('onClose', async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });
};

export default fp(socketPlugin, { name: 'socket' });
