export type UpsertProductDto = {
  name: string;
  sku: string;
  description?: string | null;
  price: number;
  isActive?: boolean;
  axonautProductId?: number | null;
};

export type UpdateProductDto = Partial<UpsertProductDto>;
