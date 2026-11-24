import { auth } from '@/src/firebase';
import type {
  CallingProviderCapabilities,
  CallingProviderId,
  CallingTokenResult,
} from '@/src/types/calling';

export const CALLING_PROVIDER_CATALOG: Record<CallingProviderId, CallingProviderCapabilities> = {
  webrtc_builtin: {
    id: 'webrtc_builtin',
    name: 'Built-in WebRTC (STUN / Coturn TURN)',
    tier: 'free',
    supportsOneToOne: true,
    supportsGroupCalls: true,
    supportsScreenSharing: true,
    supportsSfu: false,
    requiresServerToken: false,
    requiresBillingApproval: false,
    recommendedMaxMeshPeers: 8,
    notes: 'Free peer-to-peer WebRTC via Firestore/WebSocket signaling. Supports optional self-hosted Coturn TURN.',
  },
  livekit_oss: {
    id: 'livekit_oss',
    name: 'LiveKit Open-Source SFU',
    tier: 'open_source',
    supportsOneToOne: true,
    supportsGroupCalls: true,
    supportsScreenSharing: true,
    supportsSfu: true,
    requiresServerToken: true,
    requiresBillingApproval: false,
    recommendedMaxMeshPeers: 50,
    notes: 'Open-source SFU media server. Mints signed JWT access tokens via backend/.',
  },
  agora: {
    id: 'agora',
    name: 'Agora RTC (Paid)',
    tier: 'paid',
    supportsOneToOne: true,
    supportsGroupCalls: true,
    supportsScreenSharing: true,
    supportsSfu: true,
    requiresServerToken: true,
    requiresBillingApproval: true,
    recommendedMaxMeshPeers: 50,
    notes: 'Paid managed RTC provider. Blocked until explicitly approved by Admin.',
  },
  '100ms': {
    id: '100ms',
    name: '100ms Live Video (Paid)',
    tier: 'paid',
    supportsOneToOne: true,
    supportsGroupCalls: true,
    supportsScreenSharing: true,
    supportsSfu: true,
    requiresServerToken: true,
    requiresBillingApproval: true,
    recommendedMaxMeshPeers: 50,
    notes: 'Paid managed SFU provider. Blocked until explicitly approved by Admin.',
  },
};

export function getBackendBaseUrl(): string {
  const raw = String(import.meta.env.VITE_BACKEND_URL || '').trim();
  return raw ? raw.replace(/\/$/, '') : '';
}

export async function requestCallingSessionCredentials(params: {
  providerId: CallingProviderId;
  roomName: string;
  displayName?: string;
  billingApprovedByAdmin?: boolean;
}): Promise<CallingTokenResult> {
  const uid = auth.currentUser?.uid || '';
  const baseUrl = getBackendBaseUrl();

  if (params.providerId === 'webrtc_builtin' && !baseUrl) {
    return {
      providerId: 'webrtc_builtin',
      configured: true,
      channelName: params.roomName,
      uid,
      message: 'Using built-in Firestore WebRTC signaling + public STUN.',
    };
  }

  if (!baseUrl) {
    return {
      providerId: params.providerId,
      configured: false,
      channelName: params.roomName,
      uid,
      message: `Backend URL (VITE_BACKEND_URL) is required to mint server-side tokens for ${params.providerId}.`,
    };
  }

  const idToken = await auth.currentUser?.getIdToken().catch(() => null);
  if (!idToken) {
    return {
      providerId: params.providerId,
      configured: false,
      channelName: params.roomName,
      uid,
      message: 'Sign in required before requesting calling session credentials.',
    };
  }

  try {
    const resp = await fetch(`${baseUrl}/api/calling/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        providerId: params.providerId,
        roomName: params.roomName,
        displayName: params.displayName,
        billingApprovedByAdmin: Boolean(params.billingApprovedByAdmin),
      }),
    });
    const data = await resp.json().catch(() => ({}));
    return {
      providerId: params.providerId,
      configured: Boolean(resp.ok && data?.configured),
      token: data?.token,
      wsUrl: data?.wsUrl,
      appId: data?.appId,
      channelName: data?.channelName || params.roomName,
      uid: data?.uid || uid,
      expiresAtIso: data?.expiresAtIso,
      message: data?.message || data?.error || `HTTP ${resp.status}`,
    };
  } catch (err: any) {
    return {
      providerId: params.providerId,
      configured: false,
      channelName: params.roomName,
      uid,
      message: err?.message || 'Failed to contact BANA calling backend.',
    };
  }
}
