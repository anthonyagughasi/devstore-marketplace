import fs from 'fs';
import path from 'path';
import { resolvePrivateAssetPath } from '../security.ts';
import type { StorageProviderAdapter, StoredObjectResult } from './types.ts';

export function getLocalDevStorageDir(): string {
  if (process.env.PRIVATE_STORAGE_DIR?.trim()) {
    return path.resolve(process.cwd(), process.env.PRIVATE_STORAGE_DIR.trim());
  }
  return path.resolve(process.cwd(), 'private_assets');
}

export class LocalDevStorageAdapter implements StorageProviderAdapter {
  readonly mode = 'local_dev' as const;
  private readonly baseDir: string;

  constructor(baseDir = getLocalDevStorageDir()) {
    this.baseDir = baseDir;
  }

  isConfigured(): boolean {
    return process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
  }

  getMissingEnvVars(): string[] {
    return [];
  }

  async putObject(assetKey: string, buffer: Buffer): Promise<boolean> {
    if (!this.isConfigured() && !process.env.PRIVATE_STORAGE_DIR?.trim()) {
      return false;
    }
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
      const target = resolvePrivateAssetPath(this.baseDir, `${assetKey}.dat`);
      if (!target) return false;
      fs.writeFileSync(target, buffer);
      return true;
    } catch {
      return false;
    }
  }

  async readObject(
    assetKey: string,
    fallbackMeta: { filename: string; contentType: string }
  ): Promise<StoredObjectResult | null> {
    const target = resolvePrivateAssetPath(this.baseDir, `${assetKey}.dat`);
    if (!target) return null;
    try {
      if (fs.existsSync(target)) {
        return {
          filename: fallbackMeta.filename,
          contentType: fallbackMeta.contentType,
          buffer: fs.readFileSync(target),
        };
      }
    } catch {
      return null;
    }
    return null;
  }
}
