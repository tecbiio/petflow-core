export type UpsertProductDto = {
  name: string;
  sku: string;
  description?: string | null;
  price: number;
  isActive?: boolean;
};

export type UpdateProductDto = Partial<UpsertProductDto>;
