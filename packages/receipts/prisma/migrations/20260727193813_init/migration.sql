-- CreateTable
CREATE TABLE "Participant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Store" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storeId" INTEGER NOT NULL,
    "itemCode" TEXT,
    "normalizedName" TEXT NOT NULL,
    "displayName" TEXT,
    "lastSeenName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Item_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ItemSplitDefault" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "participantId" INTEGER NOT NULL,
    "percent" REAL NOT NULL,
    CONSTRAINT "ItemSplitDefault_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ItemSplitDefault_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PriceObservation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "receiptId" INTEGER NOT NULL,
    "unitPrice" REAL NOT NULL,
    "quantity" REAL NOT NULL,
    "discountAmount" REAL NOT NULL DEFAULT 0,
    "observedAt" DATETIME NOT NULL,
    CONSTRAINT "PriceObservation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PriceObservation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storeId" INTEGER NOT NULL,
    "payerId" INTEGER NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "purchaseDate" DATETIME NOT NULL,
    "subtotal" REAL NOT NULL,
    "tax" REAL NOT NULL,
    "total" REAL NOT NULL,
    "cardAmount" REAL,
    "status" TEXT NOT NULL DEFAULT 'EXTRACTED',
    "submittedAt" DATETIME,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Receipt_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Receipt_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReceiptTender" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "receiptId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    CONSTRAINT "ReceiptTender_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LineItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "receiptId" INTEGER NOT NULL,
    "itemId" INTEGER,
    "rawItemCode" TEXT,
    "rawName" TEXT NOT NULL,
    "unitPrice" REAL NOT NULL,
    "quantity" REAL NOT NULL,
    "lineTotal" REAL NOT NULL,
    "discountAmount" REAL NOT NULL DEFAULT 0,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "LineItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LineItemSplit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "lineItemId" INTEGER NOT NULL,
    "participantId" INTEGER NOT NULL,
    "percent" REAL NOT NULL,
    CONSTRAINT "LineItemSplit_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "LineItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineItemSplit_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayerExclusionRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "payer" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "VariableSplitRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pattern" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    "removedAt" DATETIME,
    "importBatchId" INTEGER,
    CONSTRAINT "ImportedTransaction_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "CsvSyncRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ImportedTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

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

-- CreateTable
CREATE TABLE "CsvImportProfile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "hasHeader" BOOLEAN NOT NULL,
    "columnCount" INTEGER NOT NULL,
    "headerSignature" TEXT,
    "columnMappingJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME
);

-- CreateTable
CREATE TABLE "CsvSyncRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "periodResultsJson" TEXT NOT NULL,
    "errorMessage" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Participant_name_key" ON "Participant"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Store_name_key" ON "Store"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Item_storeId_itemCode_key" ON "Item"("storeId", "itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "Item_storeId_normalizedName_key" ON "Item"("storeId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "ItemSplitDefault_itemId_participantId_key" ON "ItemSplitDefault"("itemId", "participantId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_sourceSha256_key" ON "Receipt"("sourceSha256");

-- CreateIndex
CREATE UNIQUE INDEX "LineItemSplit_lineItemId_participantId_key" ON "LineItemSplit"("lineItemId", "participantId");

-- CreateIndex
CREATE INDEX "PayerExclusionRule_payer_idx" ON "PayerExclusionRule"("payer");

-- CreateIndex
CREATE UNIQUE INDEX "PayerExclusionRule_payer_pattern_key" ON "PayerExclusionRule"("payer", "pattern");

-- CreateIndex
CREATE UNIQUE INDEX "VariableSplitRule_pattern_key" ON "VariableSplitRule"("pattern");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedTransaction_payer_date_description_amount_key" ON "ImportedTransaction"("payer", "date", "description", "amount");

-- CreateIndex
CREATE UNIQUE INDEX "CsvImportProfile_name_key" ON "CsvImportProfile"("name");

-- CreateIndex
CREATE INDEX "CsvImportProfile_headerSignature_idx" ON "CsvImportProfile"("headerSignature");

-- CreateIndex
CREATE INDEX "CsvImportProfile_hasHeader_columnCount_idx" ON "CsvImportProfile"("hasHeader", "columnCount");

-- SeedData: one-time backfill of the values that were previously hardcoded
-- as CsvConverterFactory.defaultPersonalExclusions / defaultSplitRulesDict.VARIABLE
-- (packages/core/src/csvConverterFactory.ts). After this migration, the DB is
-- the sole source of truth — no runtime fallback to those static defaults exists.
INSERT INTO "PayerExclusionRule" ("payer", "pattern") VALUES
    ('PATRICE', 'CVS/SPECIALTY'),
    ('PATRICE', 'BHATTIGI'),
    ('PATRICE', 'E-PAYMENT, TARGET.COM'),
    ('PATRICE', 'ETSY.COM'),
    ('PATRICE', 'Electronic Deposit Target Enterpris'),
    ('PATRICE', 'Mobile Banking Transfer Deposit'),
    ('PATRICE', 'Mobile Check Deposit'),
    ('PATRICE', 'Web Authorized Pmt'),
    ('PATRICE', 'Payment Received - Thank You!'),
    ('PATRICE', 'LULUS.COM'),
    ('PATRICE', 'Auto Transfer to Betterment Account'),
    ('BRIAN', 'BlackRock Lifepath Index 2060 K Fund'),
    ('BRIAN', 'CITI CARD'),
    ('BRIAN', 'NATIONAL MARROW'),
    ('BRIAN', 'ONLINE PAYMENT, THANK YOU'),
    ('BRIAN', 'ONLINE BANKING TRANSFER TO SHARE'),
    ('BRIAN', 'ONLINE BANKING TRANSFER FROM SHARE'),
    ('BRIAN', 'TOCA TRAINING CENTERS'),
    ('BRIAN', 'QUALIFIED DIVIDEND'),
    ('BRIAN', 'Requested transfer from ');

INSERT INTO "VariableSplitRule" ("pattern") VALUES
    ('Costco'),
    ('TARGET');

-- SeedData: a default profile matching CITI_DEFAULT_MAPPING
-- (packages/core/src/csvColumnMapping.ts) so real Citi exports auto-detect
-- via the configurator's preview step from day one — no manual
-- reconfiguration needed for the common case, only for a genuinely new
-- CSV shape.
INSERT INTO "CsvImportProfile" ("name", "hasHeader", "columnCount", "headerSignature", "columnMappingJson") VALUES (
  'Citi (default)',
  1,
  6,
  'status,date,description,debit,credit,member name',
  '{"hasHeader":true,"dateColumn":{"byName":"date"},"descriptionColumn":{"byName":"description"},"amount":{"mode":"DEBIT_CREDIT","debitColumn":{"byName":"debit"},"creditColumn":{"byName":"credit"}}}'
);
