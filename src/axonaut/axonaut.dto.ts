export class AxonautConfigDto {
  apiKey: string;
  baseUrl?: string;
  updateStockUrlTemplate?: string;
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

export class AxonautTestRequestDto {
  url?: string;
  path?: string;
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
}
