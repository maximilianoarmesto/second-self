import { PrismaClient } from '../src/generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || '';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const owner = await prisma.owner.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      cloneName: 'My Second Self',
    },
  });

  await prisma.settings.upsert({
    where: { ownerId: 1 },
    update: {},
    create: {
      ownerId: owner.id,
      cloneName: 'My Second Self',
    },
  });

  console.log('Seed completed: owner and settings created');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
