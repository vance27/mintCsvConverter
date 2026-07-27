-- CreateTable
CREATE TABLE "ImportedTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "payer" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "splitType" TEXT NOT NULL,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" DATETIME,
    "syncRunId" INTEGER,
    CONSTRAINT "ImportedTransaction_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "CsvSyncRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CsvSyncRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "periodResultsJson" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportedTransaction_payer_date_description_amount_key" ON "ImportedTransaction"("payer", "date", "description", "amount");
