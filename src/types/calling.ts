export type CallType = 'audio' | 'video';

export type CallingProviderId = 'webrtc_builtin' | 'livekit_oss' | 'agora' | '100ms';

export type CallState =
  | 'idle'
  | 'calling'
  | 'ringing'
  | 'connected'
  | 'reconnecting'
  | 'on_hold'
  | 'rejected'
  | 'missed'
  | 'ended'
  | 'failed';

export type NetworkQualityLevel = 'excellent' | 'good' | 'poor' | 'unknown';

export interface NetworkQualityStats {
  level: NetworkQualityLevel;
  rttMs: number | null;
  packetLossPct: number | null;
  bitrateKbps: number | null;
  iceType?: string;
  adaptedVideoMaxBitrateKbps?: number;
  measuredAt: number;
}

export interface SdpSignal {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface CallRecord {
  id: string;
  conversationId: string;
  callType: CallType;
  providerId?: CallingProviderId;
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  calleeId: string;
  calleeName: string;
  calleeAvatar?: string;
  status: CallState;
  offer?: SdpSignal;
  answer?: SdpSignal;
  screenSharingBy?: string;
  endReason?: string;
  durationSeconds?: number;
  expiresAtMs?: number;
  hiddenBy?: string[];
  startedAt?: any;
  endedAt?: any;
  createdAt?: any;
  updatedAt?: any;
}

export interface IceCandidateRecord {
  id: string;
  senderId: string;
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  createdAt?: any;
}

export interface GroupCallParticipant {
  uid: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
  role: 'host' | 'moderator' | 'participant';
  micMuted: boolean;
  camOff: boolean;
  screenSharing: boolean;
  speaking: boolean;
  audioLevel?: number;
  forcedMutedByHost?: boolean;
  joinedAtMs: number;
}

export interface GroupCallRecord {
  id: string;
  conversationId: string;
  conversationName: string;
  callType: CallType;
  providerId: CallingProviderId;
  hostId: string;
  hostName: string;
  invitedParticipantIds: string[];
  activeParticipantIds: string[];
  maxParticipants: number;
  status: 'active' | 'ended';
  endReason?: string;
  startedAt?: any;
  endedAt?: any;
  createdAt?: any;
  updatedAt?: any;
}

export interface GroupCallSignal {
  id: string;
  fromUid: string;
  toUid: string;
  kind: 'offer' | 'answer' | 'ice';
  sdp?: string;
  sdpType?: 'offer' | 'answer';
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  createdAt?: any;
}

export interface CallingConfigSnapshot {
  webrtcEnabled: boolean;
  allowVoiceCalls: boolean;
  allowVideoCalls: boolean;
  allowGroupCalls: boolean;
  allowScreenSharing: boolean;
  maxGroupCallParticipants: number;
  activeCallingProvider: CallingProviderId;
  stunServers: string[];
  turnRelayHint?: string;
  turnProvider?: 'none' | 'coturn' | 'metered' | 'twilio';
  maxCallDurationMinutes?: number;
}

export interface CallingProviderCapabilities {
  id: CallingProviderId;
  name: string;
  tier: 'free' | 'open_source' | 'paid';
  supportsOneToOne: boolean;
  supportsGroupCalls: boolean;
  supportsScreenSharing: boolean;
  supportsSfu: boolean;
  requiresServerToken: boolean;
  requiresBillingApproval: boolean;
  recommendedMaxMeshPeers: number;
  notes: string;
}

export interface CallingTokenResult {
  providerId: CallingProviderId;
  configured: boolean;
  token?: string;
  wsUrl?: string;
  appId?: string;
  channelName: string;
  uid: string;
  expiresAtIso?: string;
  message?: string;
}
