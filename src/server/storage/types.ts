export type StorageProviderMode = 'local_dev' | 's3' | 'unconfigured_serverless';

export interface StoredObjectResult {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

export interface StorageProviderAdapter {
  readonly mode: StorageProviderMode;
  isConfigured(): boolean;
  getMissingEnvVars(): string[];
  readObject(
    assetKey: string,
    fallbackMeta: { filename: string; contentType: string }
  ): Promise<StoredObjectResult | null>;
  putObject?(assetKey: string, buffer: Buffer, contentType: string): Promise<boolean>;
  createPresignedDownloadUrl?(
    assetKey: string,
    ttlSeconds: number,
    downloadFilename?: string
  ): string | null;
}
