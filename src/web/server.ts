import Fastify from 'fastify';
import { webhookCallback } from 'grammy';
import { logger } from '../monitoring/logger.js';
import { prisma } from '../db/client.js';
import { env } from '../config/env.js';
import { oauthTokenRepository } from '../db/repositories/oauth-token.repository.js';
import { getAuthorizationUrl, exchangeCode } from '../linkedin/oauth.js';
import { getBot } from '../review/bot.js';

export function buildServer() {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // ── Health check ───────────────────────────────────────────────────────
  server.get('/health', async (_request, reply) => {
    const checks: Record<string, string> = {};
    let overallStatus: 'ok' | 'degraded' | 'unhealthy' = 'ok';

    // Check database
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      checks.db = 'ok';
    } catch {
      checks.db = 'fail';
      overallStatus = 'unhealthy';
    }

    // Check OAuth token
    try {
      const token = await oauthTokenRepository.findByProvider('linkedin');
      if (!token) {
        checks.token = 'missing';
        if (overallStatus === 'ok') overallStatus = 'degraded';
      } else if (token.expiresAt < new Date()) {
        checks.token = 'expired';
        if (overallStatus === 'ok') overallStatus = 'degraded';
      } else {
        checks.token = 'ok';
      }
    } catch {
      checks.token = 'error';
      if (overallStatus === 'ok') overallStatus = 'degraded';
    }

    const statusCode = overallStatus === 'unhealthy' ? 503 : 200;
    return reply.status(statusCode).send({
      status: overallStatus,
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  // ── LinkedIn OAuth (Phase 1) ──────────────────────────────────────────
  server.get('/auth/linkedin', async (_request, reply) => {
    try {
      const state = Math.random().toString(36).substring(2) + Date.now().toString(36);
      // Importing getAuthorizationUrl lazily or at top. We will import at top.
      const url = getAuthorizationUrl(state);
      return reply.redirect(url);
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to generate authorization URL');
      return reply.status(500).send({ error: 'Failed to generate authorization URL', message: error.message });
    }
  });

  server.get('/auth/linkedin/callback', async (request, reply) => {
    const { code, state, error, error_description } = request.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };

    if (error) {
      logger.warn({ error, error_description }, 'OAuth callback returned error');
      return reply.status(400).send({ error, error_description });
    }

    if (!code || !state) {
      return reply.status(400).send({ error: 'Missing code or state parameters' });
    }

    try {
      await exchangeCode(code, state);
      return reply.status(200).send({
        status: 'success',
        message: 'Successfully authenticated with LinkedIn. Stored secure tokens.',
      });
    } catch (err: any) {
      logger.error({ err }, 'Failed to exchange authorization code');
      return reply.status(err.statusCode ?? 500).send({
        error: 'Authentication failed',
        message: err.message,
      });
    }
  });

  // ── Telegram webhook ────────────────────────────────────────────────────
  const bot = getBot();
  if (env.TELEGRAM_USE_WEBHOOK && bot) {
    server.post('/telegram/webhook', webhookCallback(bot, 'fastify'));
  } else {
    server.post('/telegram/webhook', async (_request, reply) => {
      return reply.status(501).send({ error: 'Telegram webhook not enabled' });
    });
  }

  // ── Global error handler ───────────────────────────────────────────────
  server.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    logger.error({ err: error, statusCode: error.statusCode }, 'Unhandled error');
    const statusCode = error.statusCode ?? 500;
    return reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : error.message,
    });
  });

  return server;
}

export async function startServer(port: number) {
  const server = buildServer();
  await server.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'Fastify server listening');
  return server;
}
