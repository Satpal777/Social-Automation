import { type Topic, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export const topicRepository = {
  async create(data: Prisma.TopicCreateInput): Promise<Topic> {
    return prisma.topic.create({ data });
  },

  async findRecentByPillar(pillar: string, limit = 20): Promise<Topic[]> {
    return prisma.topic.findMany({
      where: { pillar },
      take: limit,
      orderBy: { fetchedAt: 'desc' },
    });
  },

  async findUnused(pillar: string, limit = 10): Promise<Topic[]> {
    return prisma.topic.findMany({
      where: { pillar, usedAt: null },
      take: limit,
      orderBy: { fetchedAt: 'desc' },
    });
  },

  async markUsed(id: string): Promise<Topic> {
    return prisma.topic.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  },
};
