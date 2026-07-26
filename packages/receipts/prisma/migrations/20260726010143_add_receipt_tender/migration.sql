-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN "cardAmount" REAL;

-- CreateTable
CREATE TABLE "ReceiptTender" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "receiptId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    CONSTRAINT "ReceiptTender_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
