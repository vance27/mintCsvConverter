-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storeId" INTEGER NOT NULL,
    "itemCode" TEXT,
    "normalizedName" TEXT,
    "displayName" TEXT,
    "lastSeenName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Item_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Item" ("createdAt", "displayName", "id", "itemCode", "lastSeenName", "normalizedName", "storeId") SELECT "createdAt", "displayName", "id", "itemCode", "lastSeenName", "normalizedName", "storeId" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
CREATE UNIQUE INDEX "Item_storeId_itemCode_key" ON "Item"("storeId", "itemCode");
CREATE UNIQUE INDEX "Item_storeId_normalizedName_key" ON "Item"("storeId", "normalizedName");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
