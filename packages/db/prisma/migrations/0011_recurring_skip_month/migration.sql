-- CreateTable
CREATE TABLE "RecurringExpenseSkipMonth" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringExpenseSkipMonth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecurringExpenseSkipMonth_templateId_month_key" ON "RecurringExpenseSkipMonth"("templateId", "month");

-- CreateIndex
CREATE INDEX "RecurringExpenseSkipMonth_month_idx" ON "RecurringExpenseSkipMonth"("month");

-- AddForeignKey
ALTER TABLE "RecurringExpenseSkipMonth"
ADD CONSTRAINT "RecurringExpenseSkipMonth_templateId_fkey"
FOREIGN KEY ("templateId") REFERENCES "ExpenseTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
