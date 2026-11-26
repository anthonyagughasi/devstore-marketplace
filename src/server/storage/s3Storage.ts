import crypto from 'crypto';
import type { StorageProviderAdapter, StoredObjectResult } from './types.js';

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * Private S3-compatible object storage adapter (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces)
 * implemented with zero external SDK dependencies via AWS Signature Version 4.
 * Digital files are never served publicly; downloads use short-lived presigned URLs or server-verified streams.
 */
export class S3CompatibleStorageAdapter implements StorageProviderAdapter {
  readonly mode = 's3' as const;

  getMissingEnvVars(): string[] {
    const missing: string[] = [];
    if (!process.env.S3_BUCKET?.trim()) missing.push('S3_BUCKET');
    if (!process.env.S3_REGION?.trim()) missing.push('S3_REGION');
    if (!process.env.S3_ACCESS_KEY_ID?.trim()) missing.push('S3_ACCESS_KEY_ID');
    if (!process.env.S3_SECRET_ACCESS_KEY?.trim()) missing.push('S3_SECRET_ACCESS_KEY');
    return missing;
  }

  isConfigured(): boolean {
    return this.getMissingEnvVars().length === 0;
  }

  private getConfig() {
    const bucket = process.env.S3_BUCKET!.trim();
    const region = process.env.S3_REGION?.trim() || 'auto';
    const accessKeyId = process.env.S3_ACCESS_KEY_ID!.trim();
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY!.trim();
    const endpointRaw =
      process.env.S3_ENDPOINT?.trim() || `https://s3.${region}.amazonaws.com`;
    const forcePathStyle =
      process.env.S3_FORCE_PATH_STYLE === 'true' || Boolean(process.env.S3_ENDPOINT?.trim());

    const endpoint = new URL(endpointRaw);
    return {
      bucket,
      region,
      accessKeyId,
      secretAccessKey,
      endpoint,
      forcePathStyle,
    };
  }

  private buildObjectTarget(objectKey: string) {
    const cfg = this.getConfig();
    const cleanKey = objectKey.replace(/^\/+/, '');
    const host = cfg.forcePathStyle
      ? cfg.endpoint.host
      : `${cfg.bucket}.${cfg.endpoint.host}`;
    const canonicalUri = cfg.forcePathStyle
      ? `/${encodeRfc3986(cfg.bucket)}/${cleanKey.split('/').map(encodeRfc3986).join('/')}`
      : `/${cleanKey.split('/').map(encodeRfc3986).join('/')}`;

    return {
      ...cfg,
      host,
      canonicalUri,
      origin: `${cfg.endpoint.protocol}//${host}`,
    };
  }

  createPresignedDownloadUrl(
    assetKey: string,
    ttlSeconds: number,
    downloadFilename?: string
  ): string | null {
    if (!this.isConfigured()) return null;
    const safeKey = `private/${assetKey.replace(/[^a-zA-Z0-9._/-]/g, '')}`;
    const target = this.buildObjectTarget(safeKey);

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${target.region}/s3/aws4_request`;
    const expires = Math.max(30, Math.min(3600, Math.round(ttlSeconds)));

    const queryParams: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${target.accessKeyId}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expires),
      'X-Amz-SignedHeaders': 'host',
    };
    if (downloadFilename) {
      queryParams['response-content-disposition'] = `attachment; filename="${downloadFilename}"`;
    }

    const canonicalQueryString = Object.keys(queryParams)
      .sort()
      .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(queryParams[k])}`)
      .join('&');

    const canonicalHeaders = `host:${target.host}\n`;
    const canonicalRequest = [
      'GET',
      target.canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const kDate = hmacSha256(`AWS4${target.secretAccessKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, target.region);
    const kService = hmacSha256(kRegion, 's3');
    const kSigning = hmacSha256(kService, 'aws4_request');
    const signature = crypto
      .createHmac('sha256', kSigning)
      .update(stringToSign, 'utf8')
      .digest('hex');

    return `${target.origin}${target.canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  }

  async readObject(
    assetKey: string,
    fallbackMeta: { filename: string; contentType: string }
  ): Promise<StoredObjectResult | null> {
    const signedUrl = this.createPresignedDownloadUrl(assetKey, 120, fallbackMeta.filename);
    if (!signedUrl) return null;

    const res = await fetch(signedUrl);
    if (!res.ok) return null;

    const arrayBuf = await res.arrayBuffer();
    return {
      filename: fallbackMeta.filename,
      contentType: res.headers.get('content-type') || fallbackMeta.contentType,
      buffer: Buffer.from(arrayBuf),
    };
  }

  async putObject(assetKey: string, buffer: Buffer, contentType: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const safeKey = `private/${assetKey.replace(/[^a-zA-Z0-9._/-]/g, '')}`;
    const target = this.buildObjectTarget(safeKey);

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${target.region}/s3/aws4_request`;
    const payloadHash = sha256Hex(buffer);

    const canonicalHeaders = [
      `content-type:${contentType}`,
      `host:${target.host}`,
      `x-amz-content-sha256:${payloadHash}`,
      `x-amz-date:${amzDate}`,
    ].join('\n') + '\n';

    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [
      'PUT',
      target.canonicalUri,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const kDate = hmacSha256(`AWS4${target.secretAccessKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, target.region);
    const kService = hmacSha256(kRegion, 's3');
    const kSigning = hmacSha256(kService, 'aws4_request');
    const signature = crypto
      .createHmac('sha256', kSigning)
      .update(stringToSign, 'utf8')
      .digest('hex');

    const authorization = `AWS4-HMAC-SHA256 Credential=${target.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(`${target.origin}${target.canonicalUri}`, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        Authorization: authorization,
      },
      body: new Uint8Array(buffer),
    });

    return res.ok;
  }
}
