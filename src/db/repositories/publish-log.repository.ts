import { type PublishLog, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export const publishLogRepository = {
  async create(data: Prisma.PublishLogCreateInput): Promise<PublishLog> {
    return prisma.publishLog.create({ data });
  },

  async findByContentItemId(contentItemId: string): Promise<PublishLog[]> {
    return prisma.publishLog.findMany({
      where: { contentItemId },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getLatestAttempt(contentItemId: string): Promise<number> {
    const result = await prisma.publishLog.aggregate({
      where: { contentItemId },
      _max: { attempt: true },
    });
    return result._max.attempt ?? 0;
  },
};
