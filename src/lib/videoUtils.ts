import type { BanaReel, DiscoveryCategory } from '@/src/types/bana';
import { isSafeFileName } from '@/src/lib/mediaUtils';

export const VIDEO_MAX_SIZE_BYTES = 150 * 1024 * 1024; // 150 MB (matches storage.rules)
export const SPARK_RECOMMENDED_VIDEO_MB = 35; // Recommended max on Spark Free Plan to conserve 5 GB quota & bandwidth
export const VIDEO_MAX_DURATION_SECONDS = 180; // 3 minutes max for Reels
export const SUPPORTED_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

export interface VideoInspectionResult {
  durationSeconds: number;
  width: number;
  height: number;
  aspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
  sizeBytes: number;
  mimeType: string;
}

export function inferAspectRatio(width: number, height: number): '9:16' | '16:9' | '1:1' | '4:5' {
  if (!width || !height) return '9:16';
  const ratio = width / height;
  if (ratio <= 0.68) return '9:16';
  if (ratio <= 0.9) return '4:5';
  if (ratio <= 1.15) return '1:1';
  return '16:9';
}

export function formatDurationClock(totalSeconds: number | undefined): string {
  const s = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export async function inspectAndValidateVideo(file: File): Promise<VideoInspectionResult> {
  if (!isSafeFileName(file.name)) {
    throw new Error('This file extension is blocked for security reasons.');
  }

  const lowerName = file.name.toLowerCase();
  const hasSupportedExt = ['.mp4', '.webm', '.mov', '.m4v'].some((ext) => lowerName.endsWith(ext));
  const mime = file.type || (lowerName.endsWith('.webm') ? 'video/webm' : 'video/mp4');

  if (!SUPPORTED_VIDEO_MIME_TYPES.includes(mime) && !hasSupportedExt) {
    throw new Error('Unsupported video format. Please upload an MP4, WebM, or MOV video file.');
  }

  if (file.size <= 0) {
    throw new Error('Selected video file appears to be empty.');
  }

  if (file.size > VIDEO_MAX_SIZE_BYTES) {
    throw new Error(`Video exceeds the 150 MB upload limit (${Math.round(file.size / (1024 * 1024))} MB selected).`);
  }

  const meta = await new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);

    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read video metadata in time. Ensure the file is a valid MP4/WebM video.'));
    }, 10000);

    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const width = video.videoWidth || 720;
      const height = video.videoHeight || 1280;
      URL.revokeObjectURL(url);
      resolve({ duration, width, height });
    };

    video.onerror = () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error('Your browser could not decode this video format. Try MP4 (H.264) or WebM.'));
    };

    video.src = url;
  });

  if (meta.duration > VIDEO_MAX_DURATION_SECONDS) {
    throw new Error(
      `Reels must be ${VIDEO_MAX_DURATION_SECONDS}s (3 minutes) or shorter. Selected video is ${Math.round(meta.duration)}s.`
    );
  }

  return {
    durationSeconds: Math.max(1, Math.round(meta.duration)),
    width: meta.width,
    height: meta.height,
    aspectRatio: inferAspectRatio(meta.width, meta.height),
    sizeBytes: file.size,
    mimeType: mime,
  };
}

export async function captureFrameFromVideoElement(videoEl: HTMLVideoElement): Promise<File | null> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth || 720;
    canvas.height = videoEl.videoHeight || 1280;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(null);
          resolve(new File([blob], `reel_thumb_${Date.now()}.jpg`, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.84
      );
    });
  } catch {
    return null;
  }
}

export function detectNetworkSavingMode(): boolean {
  const conn = (navigator as any)?.connection;
  if (!conn) return false;
  return Boolean(conn.saveData || ['slow-2g', '2g', '3g'].includes(conn.effectiveType));
}

export type ReelFeedTab =
  | 'recommended'
  | 'following'
  | 'trending'
  | 'new'
  | 'Education'
  | 'Entertainment'
  | 'Technology'
  | 'Gaming'
  | 'Lifestyle';

export function rankReelsForDiscovery(
  reels: BanaReel[],
  opts: {
    tab: ReelFeedTab;
    searchQuery: string;
    followingIds: string[];
    hiddenCreatorIds: string[];
    dismissedReelIds: string[];
    interests: DiscoveryCategory[];
    interestWeights: Record<string, number>;
  }
): BanaReel[] {
  const hiddenSet = new Set(opts.hiddenCreatorIds);
  const dismissedSet = new Set(opts.dismissedReelIds);
  const followingSet = new Set(opts.followingIds);
  const interestSet = new Set(opts.interests);

  let filtered = reels.filter(
    (r) => r.status === 'active' && !hiddenSet.has(r.authorId) && !dismissedSet.has(r.id)
  );

  if (opts.tab === 'following') {
    filtered = filtered.filter((r) => followingSet.has(r.authorId));
  } else if (['Education', 'Entertainment', 'Technology', 'Gaming', 'Lifestyle'].includes(opts.tab)) {
    filtered = filtered.filter((r) => r.category === opts.tab);
  }

  if (opts.searchQuery.trim()) {
    const q = opts.searchQuery.trim().toLowerCase();
    filtered = filtered.filter((r) => {
      const hay = [
        r.title || '',
        r.caption || '',
        r.description || '',
        r.authorUsername || '',
        r.authorName || '',
        r.soundName || '',
        r.category || '',
        ...(r.hashtags || []),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  if (opts.tab === 'new') {
    return [...filtered].sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
  }

  if (opts.tab === 'trending') {
    return [...filtered].sort((a, b) => {
      const scoreA = (a.viewsCount || 0) * 1 + (a.likesCount || 0) * 4 + (a.commentsCount || 0) * 6;
      const scoreB = (b.viewsCount || 0) * 1 + (b.likesCount || 0) * 4 + (b.commentsCount || 0) * 6;
      return scoreB - scoreA;
    });
  }

  // Personalized ranking for 'recommended' and category tabs while avoiding creator repetition
  const scored = filtered.map((r) => {
    const createdMs = r.createdAt?.toMillis ? r.createdAt.toMillis() : Date.now();
    const ageHours = Math.max(1, (Date.now() - createdMs) / (1000 * 60 * 60));
    const engagement = (r.likesCount || 0) * 3 + (r.commentsCount || 0) * 5 + (r.viewsCount || 0) * 0.2;
    const followBoost = followingSet.has(r.authorId) ? 25 : 0;
    const interestBoost = r.category && interestSet.has(r.category) ? 20 : 0;
    const weightBoost = r.category ? Number(opts.interestWeights[r.category] || 0) * 4 : 0;
    const recencyBoost = 48 / Math.pow(ageHours + 2, 0.75);
    return { reel: r, score: engagement * 0.35 + followBoost + interestBoost + weightBoost + recencyBoost };
  });

  scored.sort((a, b) => b.score - a.score);

  // De-duplicate consecutive videos from the same creator when other creators exist
  const diversified: BanaReel[] = [];
  const remaining = [...scored];
  let lastAuthorId = '';
  while (remaining.length > 0) {
    const idx = remaining.findIndex((item) => item.reel.authorId !== lastAuthorId);
    const chosenIdx = idx >= 0 ? idx : 0;
    const [picked] = remaining.splice(chosenIdx, 1);
    diversified.push(picked.reel);
    lastAuthorId = picked.reel.authorId;
  }

  return diversified;
}

/**
 * Read the real duration (whole seconds, >= 1) of a local video file. Unlike inspectAndValidateVideo() this has no
 * length limit and never throws: it resolves to null when the browser cannot read the metadata.
 * Used so normal video posts persist their true duration instead of ranking code assuming a fixed length.
 */
export function probeVideoDurationSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const finish = (v: number | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      resolve(v);
    };
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () =>
      finish(Number.isFinite(video.duration) && video.duration > 0 ? Math.max(1, Math.round(video.duration)) : null);
    video.onerror = () => finish(null);
    setTimeout(() => finish(null), 10000);
    video.src = url;
  });
}
