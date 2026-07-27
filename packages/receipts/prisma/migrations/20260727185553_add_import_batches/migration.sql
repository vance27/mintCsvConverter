-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "payer" TEXT NOT NULL,
    "minDate" TEXT NOT NULL,
    "maxDate" TEXT NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "csvImportProfileId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedCount" INTEGER NOT NULL,
    "skippedDuplicateCount" INTEGER NOT NULL,
    "excludedCount" INTEGER NOT NULL,
    CONSTRAINT "ImportBatch_csvImportProfileId_fkey" FOREIGN KEY ("csvImportProfileId") REFERENCES "CsvImportProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImportedTransaction" (
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
    "removedAt" DATETIME,
    "importBatchId" INTEGER,
    CONSTRAINT "ImportedTransaction_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "CsvSyncRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ImportedTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ImportedTransaction" ("amount", "createdAt", "date", "description", "excluded", "exclusionReason", "id", "payer", "removedAt", "splitType", "syncRunId", "syncedAt") SELECT "amount", "createdAt", "date", "description", "excluded", "exclusionReason", "id", "payer", "removedAt", "splitType", "syncRunId", "syncedAt" FROM "ImportedTransaction";
DROP TABLE "ImportedTransaction";
ALTER TABLE "new_ImportedTransaction" RENAME TO "ImportedTransaction";
CREATE UNIQUE INDEX "ImportedTransaction_payer_date_description_amount_key" ON "ImportedTransaction"("payer", "date", "description", "amount");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
