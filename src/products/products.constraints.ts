import { BadRequestException } from '@nestjs/common';
import type { UpsertProductDto, UpdateProductDto } from './products.dto';

type ProductConstraintInput = UpsertProductDto | UpdateProductDto;

type NormalizeOptions = {
  /**
   * partial = true autorise l'absence de certains champs (PATCH).
   * partial = false impose les champs requis (PUT / création).
   */
  partial?: boolean;
};

export function normalizeProductPayload(dto: UpsertProductDto, options?: NormalizeOptions & { partial?: false }): UpsertProductDto;
export function normalizeProductPayload(dto: UpdateProductDto, options: NormalizeOptions & { partial: true }): UpdateProductDto;
export function normalizeProductPayload(dto: ProductConstraintInput, options: NormalizeOptions = {}) {
  const { partial = false } = options;
  const errors: string[] = [];

  const cleaned: ProductConstraintInput = {};

  const requireField = (field: string) => {
    if (!partial) {
      errors.push(`${field} is required`);
    }
  };

  if (dto.name !== undefined) {
    const name = dto.name.trim();
    if (!name) errors.push('name cannot be empty');
    else cleaned.name = name;
  } else {
    requireField('name');
  }

  if (dto.sku !== undefined) {
    const sku = dto.sku.trim();
    if (!sku) errors.push('sku cannot be empty');
    else cleaned.sku = sku;
  } else {
    requireField('sku');
  }

  if (dto.price !== undefined) {
    if (!Number.isFinite(dto.price)) {
      errors.push('price must be a number');
    } else {
      cleaned.price = dto.price;
    }
  } else {
    requireField('price');
  }

  const numericField = (value: unknown, label: string) => {
    if (value === undefined) {
      requireField(label);
      return;
    }
    if (!Number.isFinite(value as number)) errors.push(`${label} must be a number`);
    else (cleaned as any)[label] = value as number;
  };

  numericField((dto as any).priceVdiHt, 'priceVdiHt');
  numericField((dto as any).priceDistributorHt, 'priceDistributorHt');
  numericField((dto as any).priceSaleHt, 'priceSaleHt');
  numericField((dto as any).purchasePrice, 'purchasePrice');
  numericField((dto as any).tvaRate, 'tvaRate');

  if (dto.description !== undefined) {
    cleaned.description = dto.description ?? null;
  }
  if ((dto as any).packagingId !== undefined) {
    if (dto.packagingId === null) {
      cleaned.packagingId = null;
    } else if (!Number.isInteger(dto.packagingId)) {
      errors.push('packagingId must be an integer');
    } else {
      cleaned.packagingId = dto.packagingId;
    }
  }
  if (dto.isActive !== undefined) {
    cleaned.isActive = dto.isActive;
  }
  if (dto.familyId !== undefined) {
    cleaned.familyId = dto.familyId ?? null;
  }
  if (dto.subFamilyId !== undefined) {
    cleaned.subFamilyId = dto.subFamilyId ?? null;
  }

  if (partial) {
    const hasAtLeastOneField = Object.keys(dto).length > 0;
    if (!hasAtLeastOneField) errors.push('No fields provided for update');
  }

  if (errors.length > 0) {
    throw new BadRequestException(errors.join('; '));
  }

  return cleaned as typeof dto;
}
