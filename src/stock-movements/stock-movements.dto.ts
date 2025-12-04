export type CreateStockMovementDto = {
  productId: number;
  stockLocationId: number;
  quantityDelta: number;
  reason?: string;
  createdAt?: string | Date;
  sourceDocumentType?: string;
  sourceDocumentId?: string;
};
