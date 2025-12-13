export type UpsertProductDto = {
  name: string;
  sku: string;
  stockThreshold?: number;
  description?: string | null;
  price: number;
  priceVdiHt: number;
  priceDistributorHt: number;
  priceSaleHt: number;
  purchasePrice: number;
  tvaRate: number;
  packagingId?: number | null;
  isActive?: boolean;
  familyId?: number | null;
  subFamilyId?: number | null;
};

export type UpdateProductDto = Partial<UpsertProductDto>;
