import { type ReviewAction, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export const reviewActionRepository = {
  async create(data: Prisma.ReviewActionCreateInput): Promise<ReviewAction> {
    return prisma.reviewAction.create({ data });
  },

  async findByContentItemId(contentItemId: string): Promise<ReviewAction[]> {
    return prisma.reviewAction.findMany({
      where: { contentItemId },
      orderBy: { createdAt: 'desc' },
    });
  },
};
