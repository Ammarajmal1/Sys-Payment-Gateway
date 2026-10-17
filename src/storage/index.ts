import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { computeSha256 } from '../utils/crypto.js';

export interface SavedFileResult {
  storagePath: string;
  fileSizeBytes: number;
  sha256Hash: string;
}

export interface StorageAdapter {
  saveFile(originalFilename: string, buffer: Buffer, mimeType: string): Promise<SavedFileResult>;
  getFile(storagePath: string): Promise<Buffer>;
  deleteFile(storagePath: string): Promise<void>;
}

export class LocalDiskStorageAdapter implements StorageAdapter {
  private baseDir: string;

  constructor(baseDir = process.env.STORAGE_LOCAL_DIR || './storage/uploads') {
    this.baseDir = path.resolve(baseDir);
    if (!fsSync.existsSync(this.baseDir)) {
      fsSync.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async saveFile(originalFilename: string, buffer: Buffer, mimeType: string): Promise<SavedFileResult> {
    const ext = path.extname(originalFilename).toLowerCase() || (mimeType === 'image/png' ? '.png' : '.jpg');
    // Generate secure random server-side filename
    const randomName = `rec_${crypto.randomUUID()}${ext}`;
    const targetPath = path.join(this.baseDir, randomName);

    // Compute hash and size
    const sha256Hash = computeSha256(buffer);
    const fileSizeBytes = buffer.length;

    // Write file securely
    await fs.writeFile(targetPath, buffer, { mode: 0o600 });

    return {
      storagePath: targetPath,
      fileSizeBytes,
      sha256Hash,
    };
  }

  async getFile(storagePath: string): Promise<Buffer> {
    const resolved = path.resolve(storagePath);
    // Path traversal check
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error('Access denied: Storage path traversal detected');
    }
    return fs.readFile(resolved);
  }

  async deleteFile(storagePath: string): Promise<void> {
    const resolved = path.resolve(storagePath);
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error('Access denied: Storage path traversal detected');
    }
    try {
      await fs.unlink(resolved);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }
}

export class S3StorageAdapterStub implements StorageAdapter {
  async saveFile(originalFilename: string, buffer: Buffer): Promise<SavedFileResult> {
    throw new Error('S3 Storage Adapter not configured. Please set AWS_S3_BUCKET credentials.');
  }
  async getFile(): Promise<Buffer> {
    throw new Error('S3 Storage Adapter not configured.');
  }
  async deleteFile(): Promise<void> {
    throw new Error('S3 Storage Adapter not configured.');
  }
}

export function getStorageAdapter(): StorageAdapter {
  const adapterType = process.env.STORAGE_ADAPTER || 'local';
  if (adapterType === 's3') {
    return new S3StorageAdapterStub();
  }
  return new LocalDiskStorageAdapter();
}
