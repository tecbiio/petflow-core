export type CreateInventoryDto = {
  productId: number;
  stockLocationId: number;
  quantity: number;
  createdAt?: string | Date;
};
