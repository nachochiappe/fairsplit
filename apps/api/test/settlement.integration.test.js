"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const vitest_1 = require("vitest");
const db_1 = require("@fairsplit/db");
const app_1 = require("../src/app");
const app = (0, app_1.createApp)();
const month = '2026-02';
(0, vitest_1.describe)('GET /api/settlement', () => {
    (0, vitest_1.beforeAll)(async () => {
        await db_1.prisma.expense.deleteMany({ where: { month } });
        await db_1.prisma.monthlyIncome.deleteMany({ where: { month } });
        const userA = await db_1.prisma.user.upsert({
            where: { id: 'integration-a' },
            update: { name: 'Integration A' },
            create: { id: 'integration-a', name: 'Integration A' },
        });
        const userB = await db_1.prisma.user.upsert({
            where: { id: 'integration-b' },
            update: { name: 'Integration B' },
            create: { id: 'integration-b', name: 'Integration B' },
        });
        await db_1.prisma.monthlyIncome.createMany({
            data: [
                { month, userId: userA.id, amount: '6000.00' },
                { month, userId: userB.id, amount: '3000.00' },
            ],
        });
        await db_1.prisma.expense.createMany({
            data: [
                {
                    month,
                    date: new Date('2026-02-05T12:00:00.000Z'),
                    description: 'Rent',
                    category: 'Housing',
                    amount: '2400.00',
                    paidByUserId: userA.id,
                },
                {
                    month,
                    date: new Date('2026-02-10T12:00:00.000Z'),
                    description: 'Groceries',
                    category: 'Food',
                    amount: '900.00',
                    paidByUserId: userB.id,
                },
            ],
        });
    });
    (0, vitest_1.afterAll)(async () => {
        await db_1.prisma.$disconnect();
    });
    (0, vitest_1.it)('returns settlement breakdown and transfer', async () => {
        const response = await (0, supertest_1.default)(app).get('/api/settlement').query({ month });
        (0, vitest_1.expect)(response.status).toBe(200);
        (0, vitest_1.expect)(response.body.month).toBe(month);
        (0, vitest_1.expect)(response.body.totalIncome).toBe('9000.00');
        (0, vitest_1.expect)(response.body.totalExpenses).toBe('3300.00');
        (0, vitest_1.expect)(response.body.fairShareByUser['integration-a']).toBe('2200.00');
        (0, vitest_1.expect)(response.body.fairShareByUser['integration-b']).toBe('1100.00');
        (0, vitest_1.expect)(response.body.differenceByUser['integration-a']).toBe('200.00');
        (0, vitest_1.expect)(response.body.differenceByUser['integration-b']).toBe('-200.00');
        (0, vitest_1.expect)(response.body.transfer).toEqual({
            fromUserId: 'integration-b',
            toUserId: 'integration-a',
            amount: '200.00',
        });
    });
});
