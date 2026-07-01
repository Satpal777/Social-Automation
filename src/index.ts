/**
 * Application entry point.
 *
 * Boot sequence:
 * 1. Validate environment (dotenv + zod — fail fast)
 * 2. Log startup info
 * 3. Start Fastify web server
 * 4. Graceful shutdown handlers
 *
 * Scheduler registration is added in Phase 3.
 */

import { env } from './config/env.js';
import { logger } from './monitoring/logger.js';
import { startServer } from './web/server.js';
import { prisma } from './db/client.js';
import { initBot, sendAlertToTelegram } from './review/index.js';
import { startScheduler, stopScheduler } from './scheduler/index.js';

async function main() {
  logger.info(
    { nodeEnv: env.NODE_ENV, port: env.PORT },
    'Starting LinkedIn Content Automation System',
  );

  // Initialize Telegram Bot
  initBot();

  // Start web server
  const server = await startServer(env.PORT);

  // Start scheduler. A failure here (e.g. a transient DB hiccup) must not
  // take down the web server / Telegram bot that are already serving traffic.
  try {
    await startScheduler();
  } catch (err) {
    logger.error({ err }, 'Scheduler failed to start — web server and Telegram bot remain up');
    await sendAlertToTelegram(
      `Scheduler failed to start: ${(err as Error).message}. The bot and web server are still running, but no cron jobs are registered.`,
      'critical'
    ).catch(() => {});
  }

  // ── Graceful shutdown ────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal, cleaning up…');
    try {
      stopScheduler();
      await server.close();
      await prisma.$disconnect();
      logger.info('Shutdown complete');
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('Application ready');
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Fatal error during startup');
  process.exit(1);
});
