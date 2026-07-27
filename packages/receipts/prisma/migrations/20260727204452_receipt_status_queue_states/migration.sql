-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Receipt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storeId" INTEGER NOT NULL,
    "payerId" INTEGER NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "originalFilename" TEXT,
    "purchaseDate" DATETIME,
    "subtotal" REAL,
    "tax" REAL,
    "total" REAL,
    "cardAmount" REAL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "submittedAt" DATETIME,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extractionError" TEXT,
    CONSTRAINT "Receipt_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Receipt_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Receipt" ("cardAmount", "createdAt", "id", "payerId", "purchaseDate", "reconciled", "sourcePath", "sourceSha256", "status", "storeId", "submittedAt", "subtotal", "tax", "total") SELECT "cardAmount", "createdAt", "id", "payerId", "purchaseDate", "reconciled", "sourcePath", "sourceSha256", "status", "storeId", "submittedAt", "subtotal", "tax", "total" FROM "Receipt";
DROP TABLE "Receipt";
ALTER TABLE "new_Receipt" RENAME TO "Receipt";
CREATE UNIQUE INDEX "Receipt_sourceSha256_key" ON "Receipt"("sourceSha256");
CREATE INDEX "Receipt_status_createdAt_idx" ON "Receipt"("status", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
