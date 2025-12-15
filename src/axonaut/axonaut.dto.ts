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

export class AxonautSyncStockDto {
  productIds: number[];
  reason?: string;
  dryRun?: boolean;
}

export class AxonautSyncInvoicesDto {
  lookbackDays?: number;
  force?: boolean;
}

export class AxonautMarkInvoicesImportedDto {
  invoiceIds: string[];
}

export class AxonautClearPendingInvoicesDto {
  /**
   * Par défaut, on avance lastSyncAt à maintenant pour éviter que les mêmes factures reviennent au prochain sync.
   */
  advanceLastSyncAt?: boolean;
}
