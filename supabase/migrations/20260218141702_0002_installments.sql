-- AlterTable
ALTER TABLE "Expense"
ADD COLUMN "isInstallment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "installmentSeriesId" TEXT,
ADD COLUMN "installmentNumber" INTEGER,
ADD COLUMN "installmentTotal" INTEGER,
ADD COLUMN "installmentAmount" DECIMAL(14,2),
ADD COLUMN "installmentSource" TEXT,
ADD COLUMN "originalTotalAmount" DECIMAL(14,2),
ADD COLUMN "createdFromSeries" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Expense_month_isInstallment_idx" ON "Expense"("month", "isInstallment");

-- CreateIndex
CREATE INDEX "Expense_installmentSeriesId_installmentNumber_idx" ON "Expense"("installmentSeriesId", "installmentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_installmentSeriesId_month_key" ON "Expense"("installmentSeriesId", "month");
