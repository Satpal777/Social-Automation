import { type Asset, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export const assetRepository = {
  async create(data: Prisma.AssetCreateInput): Promise<Asset> {
    return prisma.asset.create({ data });
  },

  async findByContentItemId(contentItemId: string): Promise<Asset[]> {
    return prisma.asset.findMany({
      where: { contentItemId },
      orderBy: { createdAt: 'desc' },
    });
  },
};
