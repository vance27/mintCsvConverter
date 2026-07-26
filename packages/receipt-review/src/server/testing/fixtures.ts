import { ReceiptStatus, seedParticipants, type PrismaClient } from '@mint-csv-converter/receipts';

export interface SeededReceipt {
  receiptId: number;
  brianId: number;
  patriceId: number;
  storeId: number;
  itemIds: [number, number];
  lineItemIds: [number, number];
}

/** A minimal but realistic two-item, two-participant, evenly-split receipt for specs. */
export async function seedBasicReceipt(prisma: PrismaClient): Promise<SeededReceipt> {
  await seedParticipants(prisma, ['Brian', 'Patrice']);
  const [brian, patrice] = await Promise.all([
    prisma.participant.findUniqueOrThrow({ where: { name: 'Brian' } }),
    prisma.participant.findUniqueOrThrow({ where: { name: 'Patrice' } }),
  ]);
  const store = await prisma.store.create({ data: { name: 'Costco' } });
  const item1 = await prisma.item.create({
    data: { storeId: store.id, itemCode: '111', normalizedName: 'WIDGET', lastSeenName: 'WIDGET' },
  });
  const item2 = await prisma.item.create({
    data: { storeId: store.id, itemCode: '222', normalizedName: 'GADGET', lastSeenName: 'GADGET' },
  });

  const receipt = await prisma.receipt.create({
    data: {
      storeId: store.id,
      payerId: brian.id,
      sourceSha256: `fixture-${item1.id}-${item2.id}`,
      sourcePath: '/tmp/fixture.pdf',
      purchaseDate: new Date('2026-07-01'),
      subtotal: 20,
      tax: 0,
      total: 20,
      cardAmount: 20,
      status: ReceiptStatus.EXTRACTED,
      reconciled: true,
    },
  });

  const lineItem1 = await prisma.lineItem.create({
    data: {
      receiptId: receipt.id,
      itemId: item1.id,
      rawItemCode: '111',
      rawName: 'WIDGET',
      unitPrice: 10,
      quantity: 1,
      lineTotal: 10,
      discountAmount: 0,
    },
  });
  const lineItem2 = await prisma.lineItem.create({
    data: {
      receiptId: receipt.id,
      itemId: item2.id,
      rawItemCode: '222',
      rawName: 'GADGET',
      unitPrice: 10,
      quantity: 1,
      lineTotal: 10,
      discountAmount: 0,
    },
  });

  await prisma.lineItemSplit.createMany({
    data: [
      { lineItemId: lineItem1.id, participantId: brian.id, percent: 50 },
      { lineItemId: lineItem1.id, participantId: patrice.id, percent: 50 },
      { lineItemId: lineItem2.id, participantId: brian.id, percent: 50 },
      { lineItemId: lineItem2.id, participantId: patrice.id, percent: 50 },
    ],
  });

  return {
    receiptId: receipt.id,
    brianId: brian.id,
    patriceId: patrice.id,
    storeId: store.id,
    itemIds: [item1.id, item2.id],
    lineItemIds: [lineItem1.id, lineItem2.id],
  };
}
