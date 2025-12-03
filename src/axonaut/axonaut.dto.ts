export class AxonautConfigDto {
  baseUrl: string;
  apiKey: string;
  updateStockUrlTemplate: string;
  lookupProductsUrlTemplate?: string;
}

export class AxonautUpdateStockDto {
  productId: string;
  quantityDelta?: number;
  quantity?: number;
  reason?: string;
}

export class AxonautLookupDto {
  references: string[];
}
