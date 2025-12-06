import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

type EncryptedPayload = { iv: string; ciphertext: string };

@Injectable()
export class SecureConfigService {
  private readonly key: Buffer;

  constructor(private readonly prisma: PrismaService) {
    this.key = this.resolveKey();
  }

  async save(key: string, data: unknown) {
    const payload = this.encrypt(JSON.stringify(data));
    await this.prisma.client().secureConfig.upsert({
      where: { key },
      update: { iv: payload.iv, ciphertext: payload.ciphertext },
      create: { key, iv: payload.iv, ciphertext: payload.ciphertext },
    });
  }

  async load<T = unknown>(key: string): Promise<T | null> {
    const record = await this.prisma.client().secureConfig.findUnique({ where: { key } });
    if (!record) return null;
    const json = this.decrypt({ iv: record.iv, ciphertext: record.ciphertext });
    try {
      return JSON.parse(json) as T;
    } catch {
      return null;
    }
  }

  private resolveKey(): Buffer {
    const raw = process.env.SECRET_KEY_32B || process.env.AUTH_TOKEN_SECRET;
    if (!raw) {
      throw new Error('SECRET_KEY_32B (ou AUTH_TOKEN_SECRET) manquant pour chiffrer les configs sensibles.');
    }
    // On dérive systématiquement sur 32 bytes via SHA-256 pour éviter les erreurs de longueur.
    return createHash('sha256').update(raw).digest();
  }

  private encrypt(plain: string): EncryptedPayload {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([encrypted, tag]);
    return { iv: iv.toString('base64'), ciphertext: payload.toString('base64') };
  }

  private decrypt(payload: EncryptedPayload): string {
    const iv = Buffer.from(payload.iv, 'base64');
    const buf = Buffer.from(payload.ciphertext, 'base64');
    const tag = buf.subarray(buf.length - 16);
    const data = buf.subarray(0, buf.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
