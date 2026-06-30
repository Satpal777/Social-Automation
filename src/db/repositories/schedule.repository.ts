import { type Schedule, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export const scheduleRepository = {
  async findEnabled(): Promise<Schedule[]> {
    return prisma.schedule.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });
  },

  async create(data: Prisma.ScheduleCreateInput): Promise<Schedule> {
    return prisma.schedule.create({ data });
  },

  async update(id: string, data: Prisma.ScheduleUpdateInput): Promise<Schedule> {
    return prisma.schedule.update({ where: { id }, data });
  },

  async findById(id: string): Promise<Schedule | null> {
    return prisma.schedule.findUnique({ where: { id } });
  },
};
