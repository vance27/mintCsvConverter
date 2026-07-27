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

-- CreateIndex
CREATE INDEX "PayerExclusionRule_payer_idx" ON "PayerExclusionRule"("payer");

-- CreateIndex
CREATE UNIQUE INDEX "PayerExclusionRule_payer_pattern_key" ON "PayerExclusionRule"("payer", "pattern");

-- CreateIndex
CREATE UNIQUE INDEX "VariableSplitRule_pattern_key" ON "VariableSplitRule"("pattern");

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
