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

-- CreateIndex
CREATE UNIQUE INDEX "CsvImportProfile_name_key" ON "CsvImportProfile"("name");

-- CreateIndex
CREATE INDEX "CsvImportProfile_headerSignature_idx" ON "CsvImportProfile"("headerSignature");

-- CreateIndex
CREATE INDEX "CsvImportProfile_hasHeader_columnCount_idx" ON "CsvImportProfile"("hasHeader", "columnCount");
