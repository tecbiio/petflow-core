export type UpsertStockLocationDto = {
  name: string;
  code: string;
  isDefault?: boolean;
  isActive?: boolean;
};

export type UpdateStockLocationDto = Partial<UpsertStockLocationDto>;
