-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyIncome" (
    "id" TEXT NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "MonthlyIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paidByUserId" TEXT NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyIncome_month_idx" ON "MonthlyIncome"("month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyIncome_month_userId_key" ON "MonthlyIncome"("month", "userId");

-- CreateIndex
CREATE INDEX "Expense_month_idx" ON "Expense"("month");

-- CreateIndex
CREATE INDEX "Expense_paidByUserId_idx" ON "Expense"("paidByUserId");

-- AddForeignKey
ALTER TABLE "MonthlyIncome" ADD CONSTRAINT "MonthlyIncome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

