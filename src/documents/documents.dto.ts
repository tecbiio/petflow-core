import { DocumentType } from '../common/enums/document-type.enum';

export class ParseDocumentDto {
  docType: DocumentType;
}

export type ParsedLine = {
  reference: string;
  description?: string;
  quantity: number;
  axonautProductId?: number;
  axonautProductCode?: string;
  axonautProductName?: string;
  axonautProductPrice?: number;
  axonautTaxRate?: number;
  axonautPurchasePrice?: number;
  axonautPackaging?: string;
  axonautPriceVdiHt?: number;
  axonautPriceDistributorHt?: number;
};

export class IngestDocumentDto {
  docType: DocumentType;
  stockLocationId?: number;
  sourceDocumentId?: string;
  createdAt?: string;
  movementSign?: 'IN' | 'OUT';
  lines: ParsedLine[];
}
