import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HOUSEHOLD_ID = 'household_main';
const HOUSEHOLD_NAME = 'Nacho & Tatiana';
const NACHO_EMAIL = 'nacho.chiappe@gmail.com';
const TATI_EMAIL = 'tatiana.ursul@gmail.com';
const NACHO_ALIASES = ['nacho', 'nacho chiappe'];
const TATI_ALIASES = ['tatiana', 'tati', 'tatiana ursul'];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function ensureUniqueEmailNotUsed(tx: TxClient, email: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id", "name"
    FROM "User"
    WHERE lower("email") = ${normalize(email)}
  `;
  if (rows.length > 0) {
    throw new Error(`Email ${email} is already assigned to user(s): ${rows.map((row) => `${row.name} (${row.id})`).join(', ')}`);
  }
}

async function findSingleCandidateByAliases(
  tx: TxClient,
  aliases: string[],
): Promise<{ id: string; name: string; authUserId: string | null }>
{
  const users = await tx.user.findMany({
    where: {
      householdId: HOUSEHOLD_ID,
    },
    select: {
      id: true,
      name: true,
      authUserId: true,
    },
  });

  const matches = users.filter((user) => aliases.includes(normalize(user.name)));
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one user match for aliases [${aliases.join(', ')}], found ${matches.length}. Matches: ${matches
        .map((user) => `${user.name} (${user.id})`)
        .join(', ') || 'none'}`,
    );
  }

  return matches[0];
}

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.household.upsert({
      where: { id: HOUSEHOLD_ID },
      update: { name: HOUSEHOLD_NAME },
      create: { id: HOUSEHOLD_ID, name: HOUSEHOLD_NAME },
    });

    await Promise.all([
      tx.user.updateMany({ where: { householdId: null }, data: { householdId: HOUSEHOLD_ID } }),
      tx.monthlyIncome.updateMany({ where: { householdId: null }, data: { householdId: HOUSEHOLD_ID } }),
      tx.expense.updateMany({ where: { householdId: null }, data: { householdId: HOUSEHOLD_ID } }),
      tx.expenseTemplate.updateMany({ where: { householdId: null }, data: { householdId: HOUSEHOLD_ID } }),
      tx.category.updateMany({ where: { householdId: null }, data: { householdId: HOUSEHOLD_ID } }),
      tx.superCategory.updateMany({ where: { householdId: null }, data: { householdId: HOUSEHOLD_ID } }),
      tx.monthlyExchangeRate.updateMany({ where: { householdId: null }, data: { householdId: HOUSEHOLD_ID } }),
    ]);

    await Promise.all([ensureUniqueEmailNotUsed(tx, NACHO_EMAIL), ensureUniqueEmailNotUsed(tx, TATI_EMAIL)]);

    const nacho = await findSingleCandidateByAliases(tx, NACHO_ALIASES);
    const tatiana = await findSingleCandidateByAliases(tx, TATI_ALIASES);

    if (nacho.authUserId !== null) {
      throw new Error(`Expected Nacho authUserId to be null before launch, found ${nacho.authUserId}`);
    }
    if (tatiana.authUserId !== null) {
      throw new Error(`Expected Tatiana authUserId to be null before launch, found ${tatiana.authUserId}`);
    }

    await tx.user.update({
      where: { id: nacho.id },
      data: { email: NACHO_EMAIL },
    });

    await tx.user.update({
      where: { id: tatiana.id },
      data: { email: TATI_EMAIL },
    });
  });

  const rows = await prisma.user.findMany({
    where: { householdId: HOUSEHOLD_ID },
    select: { id: true, name: true, email: true, authUserId: true },
    orderBy: { createdAt: 'asc' },
  });

  // eslint-disable-next-line no-console
  console.log('Backfill complete for household_main:');
  // eslint-disable-next-line no-console
  console.table(rows);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
