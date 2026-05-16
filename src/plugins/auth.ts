import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../types/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload;
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('user', null);

  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({
          success: false,
          error: 'Missing or invalid Authorization header',
          code: 'UNAUTHORIZED',
        });
      }

      const token = authHeader.slice(7);
      try {
        const secret = process.env['JWT_SECRET']!;
        const payload = jwt.verify(token, secret) as JwtPayload;
        request.user = payload;
      } catch {
        return reply.status(401).send({
          success: false,
          error: 'Invalid or expired token',
          code: 'TOKEN_INVALID',
        });
      }
    }
  );
};

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(authPlugin, { name: 'auth' });
