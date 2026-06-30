import { type Analytic, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export const analyticsRepository = {
  async create(data: Prisma.AnalyticCreateInput): Promise<Analytic> {
    return prisma.analytic.create({ data });
  },

  async findByContentItemId(contentItemId: string): Promise<Analytic[]> {
    return prisma.analytic.findMany({
      where: { contentItemId },
      orderBy: { fetchedAt: 'desc' },
    });
  },
};
