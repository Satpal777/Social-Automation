import { type ContentItem, type ContentStatus, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export const contentItemRepository = {
  async create(data: Prisma.ContentItemCreateInput): Promise<ContentItem> {
    return prisma.contentItem.create({ data });
  },

  async findById(id: string): Promise<ContentItem | null> {
    return prisma.contentItem.findUnique({ where: { id } });
  },

  async findByStatus(status: ContentStatus, limit = 50): Promise<ContentItem[]> {
    return prisma.contentItem.findMany({
      where: { status },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  },

  async findRecent(limit = 20): Promise<ContentItem[]> {
    return prisma.contentItem.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  },

  async updateStatus(
    id: string,
    status: ContentStatus,
    data?: Partial<Pick<ContentItem, 'linkedinUrn' | 'linkedinUrl' | 'publishedAt'>>,
  ): Promise<ContentItem> {
    return prisma.contentItem.update({
      where: { id },
      data: { status, ...data },
    });
  },

  async findByDedupeKey(key: string): Promise<ContentItem | null> {
    return prisma.contentItem.findUnique({ where: { dedupeKey: key } });
  },
};
