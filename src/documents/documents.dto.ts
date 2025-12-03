import { DocumentType } from '../common/enums/document-type.enum';

export class ParseDocumentDto {
  docType: DocumentType;
}

export type ParsedLine = {
  reference: string;
  description?: string;
  quantity: number;
};

export class IngestDocumentDto {
  docType: DocumentType;
  stockLocationId?: number;
  sourceDocumentId?: string;
  lines: ParsedLine[];
}
