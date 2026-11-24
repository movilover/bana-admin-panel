import { getAuth } from 'firebase/auth';
import { uploadToMultiCloudStorage } from '@/src/lib/storage/storageManager';
import type { MediaAssetRecord, MediaCategory, StorageProviderId } from '@/src/types/storage';

const BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.sh', '.msi', '.dll', '.js', '.vbs', '.scr', '.apk'];

export function isSafeFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return !BLOCKED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export async function compressImageFile(
  file: File,
  maxWidth = 1600,
  quality = 0.82
): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return file;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const compressed = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(compressed.size < file.size ? compressed : file);
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

export async function extractVideoThumbnail(file: File): Promise<File | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);

    const cleanup = () => URL.revokeObjectURL(url);

    video.onloadeddata = () => {
      video.currentTime = Math.min(1, video.duration / 2 || 0.2);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 720;
        canvas.height = video.videoHeight || 1280;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          resolve(null);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            cleanup();
            if (!blob) {
              resolve(null);
              return;
            }
            resolve(new File([blob], `thumb_${Date.now()}.jpg`, { type: 'image/jpeg' }));
          },
          'image/jpeg',
          0.78
        );
      } catch {
        cleanup();
        resolve(null);
      }
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    video.src = url;
  });
}

function inferCategoryAndCollection(path: string, mimeType: string): {
  mediaCategory: MediaCategory;
  sourceCollection: MediaAssetRecord['sourceCollection'];
} {
  const lower = path.toLowerCase();
  if (lower.startsWith('reels/')) {
    if (lower.includes('thumb_')) return { mediaCategory: 'thumbnail', sourceCollection: 'reels' };
    if (lower.includes('captions_')) return { mediaCategory: 'captions', sourceCollection: 'reels' };
    return { mediaCategory: 'reel', sourceCollection: 'reels' };
  }
  if (lower.startsWith('stories/')) return { mediaCategory: 'story', sourceCollection: 'stories' };
  if (lower.startsWith('voice/')) return { mediaCategory: 'voice', sourceCollection: 'voiceComments' };
  if (lower.startsWith('posts/')) {
    return {
      mediaCategory: mimeType.startsWith('video/') ? 'post_video' : 'image',
      sourceCollection: 'posts',
    };
  }
  if (lower.startsWith('messages/') || lower.startsWith('chats/')) {
    return { mediaCategory: mimeType.startsWith('audio/') ? 'voice' : 'other', sourceCollection: 'messages' };
  }
  if (lower.startsWith('marketplace/') || lower.startsWith('products/')) {
    return { mediaCategory: 'image', sourceCollection: 'marketplaceListings' };
  }
  if (lower.startsWith('communities/')) return { mediaCategory: 'image', sourceCollection: 'communities' };
  if (lower.startsWith('ads/')) return { mediaCategory: 'image', sourceCollection: 'adCreatives' };
  if (lower.startsWith('users/') || lower.startsWith('profiles/')) {
    return { mediaCategory: 'image', sourceCollection: 'users' };
  }
  return {
    mediaCategory: mimeType.startsWith('video/') ? 'post_video' : mimeType.startsWith('image/') ? 'image' : 'other',
    sourceCollection: 'other',
  };
}

export interface UploadedMediaResult {
  url: string;
  assetId: string;
  checksumSha256: string;
  providerId: StorageProviderId;
  objectKey: string;
  backupJobId?: string;
}

export async function uploadMediaWithMetadata(
  path: string,
  file: Blob | File,
  opts?: {
    onProgress?: (pct: number) => void;
    contentType?: string;
    ownerUid?: string;
    durationSeconds?: number;
    width?: number;
    height?: number;
    abortSignal?: AbortSignal;
    queueBackup?: boolean;
  }
): Promise<UploadedMediaResult> {
  if (file instanceof File && !isSafeFileName(file.name)) {
    throw new Error('File type is blocked for security reasons.');
  }

  const uid = opts?.ownerUid || getAuth().currentUser?.uid || '';
  if (!uid) {
    throw new Error('Authentication required before uploading media.');
  }

  const mimeType =
    opts?.contentType ||
    (file instanceof File ? file.type : 'application/octet-stream') ||
    'application/octet-stream';
  const inferred = inferCategoryAndCollection(path, mimeType);

  const res = await uploadToMultiCloudStorage({
    ownerUid: uid,
    objectKey: path,
    file,
    mimeType,
    mediaCategory: inferred.mediaCategory,
    sourceCollection: inferred.sourceCollection,
    durationSeconds: opts?.durationSeconds,
    width: opts?.width,
    height: opts?.height,
    onProgress: opts?.onProgress,
    abortSignal: opts?.abortSignal,
    queueBackup: opts?.queueBackup,
  });

  return {
    url: res.metadata.url,
    assetId: res.assetId,
    checksumSha256: res.checksumSha256,
    providerId: res.metadata.providerId,
    objectKey: res.metadata.objectKey,
    backupJobId: res.backupJobId,
  };
}

/**
 * Unified upload helper routing ALL BANA uploads through Multi-Cloud Object Storage
 * (Cloudflare R2 / active Primary) — Firebase Cloud Storage is NOT used on Spark Plan.
 */
export async function uploadMediaWithProgress(
  path: string,
  file: Blob | File,
  onProgress?: (pct: number) => void,
  contentType?: string
): Promise<string> {
  const res = await uploadMediaWithMetadata(path, file, {
    onProgress,
    contentType,
  });
  return res.url;
}

export function formatCompactNumber(num: number | undefined): string {
  const n = Number(num || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatRelativeTime(ts: any): string {
  if (!ts) return 'Just now';
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(date.getTime())) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}
