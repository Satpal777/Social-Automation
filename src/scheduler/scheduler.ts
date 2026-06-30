import { Cron } from 'croner';
import { prisma } from '../db/client.js';
import { scheduleRepository } from '../db/repositories/schedule.repository.js';
import { runContentJob } from '../content/orchestrator.js';
import { publish } from '../linkedin/publish.js';
import {
  sendDraftToTelegram,
  sendManualRequiredToTelegram,
  sendAlertToTelegram,
} from '../review/bot.js';
import { logger } from '../monitoring/logger.js';
import { fetchAnalytics } from '../analytics/index.js';
import type { ContentItem, Schedule } from '@prisma/client';

const activeCronJobs = new Map<string, Cron>();
const log = logger.child({ module: 'scheduler' });

/**
 * Route the generated content item to the appropriate review/publishing channel.
 */
export async function routeContentItem(item: ContentItem): Promise<void> {
  const contentItemId = item.id;
  log.info({ contentItemId, status: item.status, mode: item.mode }, 'Routing content item');

  if (item.status === 'manual_required') {
    await sendManualRequiredToTelegram(item);
  } else if (item.mode === 'draft') {
    await sendDraftToTelegram(item);
  } else if (item.mode === 'auto') {
    try {
      log.info({ contentItemId }, 'Auto-mode publishing post');
      await publish(item);
    } catch (err: any) {
      log.error({ err, contentItemId }, 'Auto-mode publishing failed');
      await sendAlertToTelegram(
        `Failed auto-publishing content item: ${err.message}`,
        'error',
        { contentItemId }
      );
    }
  } else if (item.mode === 'silent') {
    await sendAlertToTelegram(
      `Silent post generated successfully: "${item.title}". Check database.`,
      'info',
      { contentItemId }
    );
  }
}

/**
 * Cycle helper to pick the next value in rotation based on last posted item.
 */
function getNextInRotation(rotation: string[], lastValue: string | null): string {
  if (rotation.length === 0) return '';
  if (!lastValue) return rotation[0] as string;
  const idx = rotation.indexOf(lastValue);
  if (idx === -1 || idx === rotation.length - 1) return rotation[0] as string;
  return rotation[idx + 1] as string;
}

/**
 * Run the pipeline for a triggered schedule slot.
 */
async function triggerScheduleJob(schedule: Schedule) {
  const scheduleId = schedule.id;
  log.info({ scheduleId, scheduleName: schedule.name }, 'Triggering scheduled content job');

  try {
    // 1. Fetch latest content item to determine last used pillar/format in rotation
    const lastItem = await prisma.contentItem.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    const pillarRotation = (schedule.pillarRotation as string[]) || [];
    const formatRotation = (schedule.formatRotation as string[]) || [];

    const lastPillar = lastItem?.pillar || null;
    const lastFormat = lastItem?.format || null;

    const nextPillar = getNextInRotation(pillarRotation, lastPillar) || 'software-engineering';
    const nextFormat = (getNextInRotation(formatRotation, lastFormat) || 'text') as any;

    log.info(
      { nextPillar, nextFormat, mode: schedule.mode },
      'Resolved next pillar and format from rotations'
    );

    // 2. Run content generation job
    const contentItem = await runContentJob({
      pillar: nextPillar,
      format: nextFormat,
      mode: schedule.mode,
      scheduleId,
    });

    // 3. Route content item
    await routeContentItem(contentItem);
  } catch (err: any) {
    log.error({ err, scheduleId }, 'Scheduled pipeline execution failed');
    await sendAlertToTelegram(
      `Pipeline failed for schedule "${schedule.name}": ${err.message}`,
      'critical',
      { scheduleId }
    );
  }
}

/**
 * Seed a default schedule slot if the database is empty.
 */
async function seedDefaultScheduleIfEmpty() {
  const count = await prisma.schedule.count();
  if (count === 0) {
    log.info('No posting schedules found in database. Seeding a default daily draft schedule.');
    await scheduleRepository.create({
      name: 'daily-morning-drafts',
      cron: '0 9 * * *', // 9:00 AM daily
      timezone: 'UTC',
      pillarRotation: [
        'ai-technology-updates',
        'software-engineering',
        'developer-productivity-tips',
        'industry-insights-startups',
      ] as any,
      formatRotation: ['text', 'text', 'carousel', 'text', 'image'] as any,
      mode: 'draft',
      enabled: true,
    });
  }
}

/**
 * Start the in-process scheduler, registering all enabled database schedules.
 */
export async function startScheduler(): Promise<void> {
  log.info('Initializing scheduler');

  // Seed default if empty
  await seedDefaultScheduleIfEmpty();

  // Load enabled schedules
  const schedules = await scheduleRepository.findEnabled();
  log.info({ count: schedules.length }, 'Loaded enabled schedules');

  // Stop any existing jobs first
  stopScheduler();

  for (const schedule of schedules) {
    try {
      log.info(
        { scheduleId: schedule.id, cron: schedule.cron, timezone: schedule.timezone },
        `Registering cron job: ${schedule.name}`
      );

      const job = new Cron(
        schedule.cron,
        { timezone: schedule.timezone },
        () => void triggerScheduleJob(schedule)
      );

      activeCronJobs.set(schedule.id, job);
    } catch (err: any) {
      log.error({ err, scheduleId: schedule.id }, `Failed to register schedule: ${schedule.name}`);
    }
  }

  // Register daily analytics fetch job
  try {
    log.info('Registering daily analytics fetcher cron job');
    const analyticsJob = new Cron('0 0 * * *', { timezone: 'UTC' }, () => void fetchAnalytics());
    activeCronJobs.set('analytics-fetcher-job', analyticsJob);
  } catch (err: any) {
    log.error({ err }, 'Failed to register analytics fetcher cron job');
  }

  log.info('Scheduler started successfully');
}

/**
 * Stop all active cron jobs.
 */
export function stopScheduler(): void {
  if (activeCronJobs.size > 0) {
    log.info({ count: activeCronJobs.size }, 'Stopping active cron jobs');
    for (const [id, job] of activeCronJobs.entries()) {
      job.stop();
      activeCronJobs.delete(id);
    }
  }
}
