import type { OAuthToken } from '@prisma/client';
import { prisma } from '../client.js';

export const oauthTokenRepository = {
  async upsert(
    provider: string,
    data: {
      accessToken: string;
      refreshToken?: string;
      expiresAt: Date;
      scope: string;
      memberUrn?: string;
    },
  ): Promise<OAuthToken> {
    return prisma.oAuthToken.upsert({
      where: { provider },
      create: { provider, ...data },
      update: data,
    });
  },

  async findByProvider(provider: string): Promise<OAuthToken | null> {
    return prisma.oAuthToken.findUnique({ where: { provider } });
  },

  async updateToken(
    provider: string,
    accessToken: string,
    expiresAt: Date,
    refreshToken?: string,
  ): Promise<OAuthToken> {
    return prisma.oAuthToken.update({
      where: { provider },
      data: {
        accessToken,
        expiresAt,
        ...(refreshToken !== undefined && { refreshToken }),
      },
    });
  },
};
