export type UpsertProductDto = {
  name: string;
  sku: string;
  description?: string | null;
  price: number;
  isActive?: boolean;
  familyId?: number | null;
  subFamilyId?: number | null;
};

export type UpdateProductDto = Partial<UpsertProductDto>;
