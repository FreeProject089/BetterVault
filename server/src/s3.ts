import { createHash, createHmac } from 'node:crypto';

/**
 * Client S3 minimal (signature AWS Version 4, sans dépendance) : MinIO, Garage, AWS, Backblaze B2, Scaleway, OVH…
 */

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Préfixe des objets, ex. « bettervault/ » */
  prefix: string;
  /** Adresse https://hôte/bucket/objet (MinIO, Garage) plutôt que https://bucket.hôte/objet */
  pathStyle: boolean;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified: number;
}

export interface S3Like {
  put(key: string, body: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  list(prefix: string): Promise<S3Object[]>;
  delete(key: string): Promise<void>;
}

const hashHex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const xmlText = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export class S3Client implements S3Like {
  private readonly config: S3Config;
  private readonly fetchImpl: typeof fetch;

  constructor(config: S3Config, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  /** Signe une requête ; exposé pour les tests */
  sign(method: string, key: string, query: Record<string, string>, payload: Buffer, date: Date, contentType?: string) {
    const endpoint = new URL(this.config.endpoint);
    const basePath = endpoint.pathname.replace(/\/+$/, '');
    const encodedKey = key.split('/').map(encode).join('/');
    const host = this.config.pathStyle ? endpoint.host : `${this.config.bucket}.${endpoint.host}`;
    const path = this.config.pathStyle ? `${basePath}/${this.config.bucket}/${encodedKey}` : `${basePath}/${encodedKey}`;
    const canonicalQuery = Object.keys(query).sort().map(k => `${encode(k)}=${encode(query[k])}`).join('&');

    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = amzDate.slice(0, 8);
    const payloadHash = hashHex(payload);
    const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    if (contentType) headers['content-type'] = contentType;
    const signedHeaders = Object.keys(headers).sort();

    const canonicalRequest = [
      method,
      path,
      canonicalQuery,
      signedHeaders.map(h => `${h}:${headers[h]}\n`).join(''),
      signedHeaders.join(';'),
      payloadHash
    ].join('\n');
    const scope = `${day}/${this.config.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hashHex(canonicalRequest)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.config.secretAccessKey}`, day), this.config.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const { host: _host, ...sent } = headers;
    return {
      url: `${endpoint.protocol}//${host}${path}${canonicalQuery ? `?${canonicalQuery}` : ''}`,
      headers: {
        ...sent,
        authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`
      }
    };
  }

  private async request(method: string, key: string, options: { query?: Record<string, string>; body?: Buffer; contentType?: string } = {}): Promise<Response> {
    const payload = options.body ?? Buffer.alloc(0);
    const { url, headers } = this.sign(method, key, options.query ?? {}, payload, new Date(), options.contentType);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method, headers, body: method === 'PUT' ? new Uint8Array(payload) : undefined });
    } catch (err) {
      throw new Error(`Stockage S3 injoignable (${this.config.endpoint}) : ${err instanceof Error ? err.message : err}`);
    }
    if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
      const text = (await response.text()).slice(0, 300);
      const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
      throw new Error(`S3 ${method} ${key || '/'} : HTTP ${response.status}${code ? ` (${code})` : ''}`);
    }
    return response;
  }

  async put(key: string, body: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    await this.request('PUT', key, { body, contentType });
  }

  async get(key: string): Promise<Buffer> {
    return Buffer.from(await (await this.request('GET', key)).arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await this.request('DELETE', key);
  }

  async list(prefix: string): Promise<S3Object[]> {
    const objects: S3Object[] = [];
    let token: string | undefined;
    do {
      const query: Record<string, string> = { 'list-type': '2', prefix };
      if (token) query['continuation-token'] = token;
      const xml = await (await this.request('GET', '', { query })).text();
      for (const [, entry] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = /<Key>([\s\S]*?)<\/Key>/.exec(entry)?.[1];
        if (!key) continue;
        objects.push({
          key: xmlText(key),
          size: Number(/<Size>(\d+)<\/Size>/.exec(entry)?.[1] ?? 0),
          lastModified: Date.parse(/<LastModified>([^<]+)<\/LastModified>/.exec(entry)?.[1] ?? '') || 0
        });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlText(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '') || undefined : undefined;
    } while (token);
    return objects;
  }
}
