import { Injectable, Logger } from '@nestjs/common';
import { AxonautConfigDto, AxonautLookupDto, AxonautUpdateStockDto } from './axonaut.dto';

type AxonautConfig = AxonautConfigDto;

@Injectable()
export class AxonautService {
  private readonly logger = new Logger(AxonautService.name);
  private config: AxonautConfig | null = null;

  setConfig(dto: AxonautConfigDto) {
    this.config = dto;
    this.logger.log('Configuration Axonaut mise à jour en mémoire.');
  }

  getConfig() {
    return this.config;
  }

  async updateStock(dto: AxonautUpdateStockDto) {
    if (!this.config) throw new Error('Config Axonaut manquante. Appelez /axonaut/config avant /axonaut/update-stock.');
    const { baseUrl, apiKey, updateStockUrlTemplate } = this.config;
    const url = this.interpolate(updateStockUrlTemplate, dto.productId);

    const body: Record<string, unknown> = {};
    if (dto.quantity !== undefined) body.quantity = dto.quantity;
    if (dto.quantityDelta !== undefined) body.quantityDelta = dto.quantityDelta;
    if (dto.reason) body.reason = dto.reason;

    const response = await fetch(this.normalize(baseUrl, url), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        userApiKey: apiKey,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Axonaut stock update failed: ${response.status} ${response.statusText} — ${text.slice(0, 200)}`);
    }

    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    return { ok: true, status: response.status, body: json };
  }

  async lookup(dto: AxonautLookupDto) {
    if (!this.config?.lookupProductsUrlTemplate) {
      throw new Error('Config Axonaut incomplète: lookupProductsUrlTemplate manquante.');
    }
    const { baseUrl, apiKey, lookupProductsUrlTemplate } = this.config;
    const results: Record<string, { id?: string | number; raw?: unknown }> = {};

    for (const reference of dto.references) {
      const url = this.interpolate(lookupProductsUrlTemplate, reference);
      const response = await fetch(this.normalize(baseUrl, url), {
        headers: { userApiKey: apiKey },
      });
      const text = await response.text();
      if (!response.ok) {
        results[reference] = { raw: { error: `${response.status} ${response.statusText}`, body: text } };
        continue;
      }
      try {
        const json = text ? JSON.parse(text) : {};
        const id = this.extractId(json);
        results[reference] = { id, raw: json };
      } catch {
        results[reference] = { raw: text };
      }
    }

    return results;
  }

  private interpolate(template: string, reference: string) {
    return template.replace('{product_id}', encodeURIComponent(reference)).replace('{reference}', encodeURIComponent(reference));
  }

  private normalize(base: string, path: string) {
    if (path.startsWith('http')) return path;
    return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  }

  private extractId(payload: any): string | number | undefined {
    if (!payload) return undefined;
    if (typeof payload === 'object') {
      if ('id' in payload && (typeof payload.id === 'string' || typeof payload.id === 'number')) {
        return payload.id;
      }
      if ('data' in payload && payload.data) {
        const data = (payload as any).data;
        if (typeof data === 'object') {
          if ('id' in data && (typeof data.id === 'string' || typeof data.id === 'number')) {
            return data.id;
          }
          if (Array.isArray(data) && data.length > 0) {
            const first = data[0];
            if (first && (typeof first.id === 'string' || typeof first.id === 'number')) {
              return first.id;
            }
          }
        }
      }
      if (Array.isArray(payload) && payload.length > 0) {
        const first = payload[0];
        if (first && (typeof first.id === 'string' || typeof first.id === 'number')) {
          return first.id;
        }
      }
    }
    return undefined;
  }
}
