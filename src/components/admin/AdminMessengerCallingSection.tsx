import React, { useEffect, useMemo, useState } from 'react';
import { Lock, PhoneCall, Search } from 'lucide-react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { invokeCloudFunction } from '@/src/lib/firebasePlan';
import { AdminCard, AdminKpiTile, AdminPagination, AdminStateIndicator } from '@/src/components/admin/AdminShared';
import { isFunctionsFallbackError } from '@/src/lib/monetization';

interface AdminMessengerCallingSectionProps {
  reports: any[];
  users: any[];
  callsLog: any[];
  initialCallingSettings: {
    webrtcEnabled: boolean;
    allowVoiceCalls: boolean;
    allowVideoCalls: boolean;
    allowGroupCalls?: boolean;
    allowScreenSharing?: boolean;
    maxGroupCallParticipants?: number;
    activeCallingProvider?: string;
    stunServers: string[];
    turnRelayHint: string;
    turnProvider: 'none' | 'coturn' | 'metered' | 'twilio';
    maxCallDurationMinutes: number;
  };
  canManageUsers: boolean;
  canManageCalling: boolean;
  onWriteAudit: (action: string, targetType: string, targetId: string, summary: string) => Promise<void>;
  onNotifyAction: (msg: string) => void;
  onAskConfirm: (cfg: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    action: () => Promise<void>;
  }) => void;
}

const PAGE_SIZE = 10;

export function AdminMessengerCallingSection({
  reports,
  users,
  callsLog,
  initialCallingSettings,
  canManageUsers,
  canManageCalling,
  onWriteAudit,
  onNotifyAction,
  onAskConfirm,
}: AdminMessengerCallingSectionProps) {
  const [webrtcEnabled, setWebrtcEnabled] = useState(initialCallingSettings.webrtcEnabled);
  const [allowVoiceCalls, setAllowVoiceCalls] = useState(initialCallingSettings.allowVoiceCalls);
  const [allowVideoCalls, setAllowVideoCalls] = useState(initialCallingSettings.allowVideoCalls);
  const [allowGroupCalls, setAllowGroupCalls] = useState(initialCallingSettings.allowGroupCalls !== false);
  const [allowScreenSharing, setAllowScreenSharing] = useState(initialCallingSettings.allowScreenSharing !== false);
  const [maxGroupParticipants, setMaxGroupParticipants] = useState(
    String(initialCallingSettings.maxGroupCallParticipants || 8)
  );
  const [activeCallingProvider, setActiveCallingProvider] = useState(
    initialCallingSettings.activeCallingProvider || 'webrtc_builtin'
  );
  const [stunRaw, setStunRaw] = useState(initialCallingSettings.stunServers.join(', '));
  const [turnHint, setTurnHint] = useState(initialCallingSettings.turnRelayHint);
  const [turnProvider, setTurnProvider] = useState(initialCallingSettings.turnProvider);
  const [maxMin, setMaxMin] = useState(String(initialCallingSettings.maxCallDurationMinutes));
  const [userSearch, setUserSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setWebrtcEnabled(initialCallingSettings.webrtcEnabled);
    setAllowVoiceCalls(initialCallingSettings.allowVoiceCalls);
    setAllowVideoCalls(initialCallingSettings.allowVideoCalls);
    setAllowGroupCalls(initialCallingSettings.allowGroupCalls !== false);
    setAllowScreenSharing(initialCallingSettings.allowScreenSharing !== false);
    setMaxGroupParticipants(String(initialCallingSettings.maxGroupCallParticipants || 8));
    setActiveCallingProvider(initialCallingSettings.activeCallingProvider || 'webrtc_builtin');
    setStunRaw(initialCallingSettings.stunServers.join(', '));
    setTurnHint(initialCallingSettings.turnRelayHint);
    setTurnProvider(initialCallingSettings.turnProvider);
    setMaxMin(String(initialCallingSettings.maxCallDurationMinutes));
  }, [initialCallingSettings]);

  const messengerReports = useMemo(
    () => reports.filter((r) => r.targetType === 'message' || r.targetType === 'conversation' || r.targetType === 'user'),
    [reports]
  );

  const callMetrics = useMemo(() => {
    const total = callsLog.length;
    const ended = callsLog.filter((c) => c.status === 'ended' || c.status === 'connected').length;
    const missedOrFailed = callsLog.filter((c) => ['missed', 'failed', 'rejected'].includes(c.status)).length;
    const rate = total > 0 ? Math.round((ended / total) * 100) : 0;
    return { total, ended, missedOrFailed, rate };
  }, [callsLog]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return users.filter((u) => {
      if (!q) return true;
      return (
        String(u.displayName || '').toLowerCase().includes(q) ||
        String(u.username || '').toLowerCase().includes(q) ||
        String(u.id || '').toLowerCase().includes(q)
      );
    });
  }, [users, userSearch]);

  const pagedUsers = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredUsers.slice(start, start + PAGE_SIZE);
  }, [filteredUsers, page]);

  const toggleMessagingRestriction = async (u: any) => {
    const nextRestricted = !u.messagingRestricted;
    try {
      await invokeCloudFunction('adminManageUserStatus', {
        targetUid: u.id,
        messagingRestricted: nextRestricted,
      });
    } catch (err: any) {
      if (!isFunctionsFallbackError(err)) throw err;
      // Private field: lives in userPrivate (owner/admin readable), not on the public profile.
      await setDoc(doc(db, 'userPrivate', u.id), {
        uid: u.id,
        messagingRestricted: nextRestricted,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await onWriteAudit(
        nextRestricted ? 'restrict_messaging' : 'restore_messaging',
        'user',
        u.id,
        `${nextRestricted ? 'Restricted' : 'Restored'} messaging & calling for @${u.username}`
      );
    }
    onNotifyAction(`Messaging ${nextRestricted ? 'restricted' : 'restored'} for @${u.username}.`);
  };

  return (
    <div className="space-y-4">
      {/* Privacy Isolation Notice */}
      <AdminCard className="p-4 flex items-start gap-3">
        <Lock className="w-4 h-4 text-[#1877F2] shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-bold text-neutral-950 dark:text-white">
            End-to-End Privacy Isolation Guaranteed
          </p>
          <p className="text-neutral-600 dark:text-neutral-400">
            Firestore security rules strictly isolate private Messenger `conversations`, `messages`, and peer-to-peer WebRTC media streams from administrative read access. Admins only review user-submitted abuse reports and manage messaging/call privilege restrictions or STUN/TURN infrastructure health.
          </p>
        </div>
      </AdminCard>

      {/* Calling Health Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <AdminKpiTile label="Signaled Call Sessions" value={callMetrics.total} />
        <AdminKpiTile label="Connected / Ended" value={callMetrics.ended} tone="emerald" />
        <AdminKpiTile label="Missed / Rejected / Failed" value={callMetrics.missedOrFailed} tone="amber" />
        <AdminKpiTile label="Session Completion Rate" value={`${callMetrics.rate}%`} tone="primary" />
      </div>

      {/* Calling & WebRTC STUN/TURN Configuration */}
      <AdminCard className="p-5 space-y-4 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display font-bold text-base flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-[#1877F2]" />
              WebRTC Audio & Video Calling Service
            </h2>
            <p className="text-neutral-500">
              Manage voice/video call toggles, STUN endpoints, and TURN relay metadata (`adminSettings/calling`).
            </p>
          </div>
          <span className="font-mono text-[11px] text-neutral-500">
            TURN Provider: {turnProvider}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {[
            { label: 'Enable Calling', val: webrtcEnabled, set: setWebrtcEnabled },
            { label: 'Voice Calls', val: allowVoiceCalls, set: setAllowVoiceCalls },
            { label: 'Video Calls', val: allowVideoCalls, set: setAllowVideoCalls },
            { label: 'Group Calls', val: allowGroupCalls, set: setAllowGroupCalls },
            { label: 'Screen Sharing', val: allowScreenSharing, set: setAllowScreenSharing },
          ].map((item) => (
            <label
              key={item.label}
              className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950"
            >
              <span className="font-medium">{item.label}</span>
              <input
                type="checkbox"
                disabled={!canManageCalling}
                checked={item.val}
                onChange={(e) => item.set(e.target.checked)}
                className="accent-[#1877F2]"
              />
            </label>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="font-medium block">Active Calling Provider</label>
            <select
              disabled={!canManageCalling}
              value={activeCallingProvider}
              onChange={(e) => setActiveCallingProvider(e.target.value)}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
            >
              <option value="webrtc_builtin">Built-in WebRTC (Free STUN/TURN)</option>
              <option value="livekit_oss">LiveKit Open-Source SFU</option>
              <option value="agora">Agora RTC (Requires Paid Approval)</option>
              <option value="100ms">100ms Video (Requires Paid Approval)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="font-medium block">Max Group Call Participants (2–50)</label>
            <input
              type="number"
              min={2}
              max={50}
              disabled={!canManageCalling}
              value={maxGroupParticipants}
              onChange={(e) => setMaxGroupParticipants(e.target.value)}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium block">TURN Relay Provider</label>
            <select
              disabled={!canManageCalling}
              value={turnProvider}
              onChange={(e) => setTurnProvider(e.target.value as any)}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
            >
              <option value="none">STUN Only (No TURN configured)</option>
              <option value="coturn">Self-hosted Coturn (HMAC Secret)</option>
              <option value="metered">Metered Global TURN</option>
              <option value="twilio">Twilio Network Traversal</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="font-medium block">Max Call Duration (Minutes)</label>
            <input
              type="number"
              min={5}
              max={240}
              disabled={!canManageCalling}
              value={maxMin}
              onChange={(e) => setMaxMin(e.target.value)}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium block">Public STUN Servers (comma-separated)</label>
            <input
              type="text"
              disabled={!canManageCalling}
              value={stunRaw}
              onChange={(e) => setStunRaw(e.target.value)}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium block">TURN Relay Hostname Hint (non-secret)</label>
            <input
              type="text"
              disabled={!canManageCalling}
              value={turnHint}
              onChange={(e) => setTurnHint(e.target.value)}
              placeholder="turn:relay.bana.app:3478"
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
            />
          </div>
        </div>

        {canManageCalling && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={async () => {
                const stunList = stunRaw
                  .split(/[\n,]/)
                  .map((s) => s.trim())
                  .filter((s) => s.startsWith('stun:'));
                const payload = {
                  webrtcEnabled,
                  allowVoiceCalls,
                  allowVideoCalls,
                  allowGroupCalls,
                  allowScreenSharing,
                  maxGroupCallParticipants: Math.max(2, Math.min(50, Number(maxGroupParticipants) || 8)),
                  activeCallingProvider,
                  stunServers:
                    stunList.length > 0
                      ? stunList
                      : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
                  turnRelayHint: turnHint.trim(),
                  turnProvider,
                  maxCallDurationMinutes: Math.max(5, Math.min(240, Number(maxMin) || 60)),
                };
                try {
                  await invokeCloudFunction('configureTurnMetadata', payload);
                } catch (fnErr: any) {
                  if (!isFunctionsFallbackError(fnErr)) throw fnErr;
                  await setDoc(doc(db, 'adminSettings', 'calling'), {
                    ...payload,
                    updatedAt: serverTimestamp(),
                  });
                  await onWriteAudit(
                    'update_calling_settings',
                    'adminSettings',
                    'calling',
                    'Updated WebRTC calling & STUN/TURN configuration'
                  );
                }
                onNotifyAction('Calling service configuration saved.');
              }}
              className="px-4 py-2 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white font-semibold"
            >
              Save Calling Settings
            </button>
          </div>
        )}
      </AdminCard>

      {/* Messenger Abuse Reports & Messaging/Call Restrictions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AdminCard className="p-5 space-y-3 text-xs">
          <h3 className="font-display font-bold text-sm">Messenger & User Safety Reports ({messengerReports.length})</h3>
          {messengerReports.length === 0 ? (
            <p className="text-neutral-500 py-6 text-center">No Messenger safety reports in queue.</p>
          ) : (
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {messengerReports.slice(0, 12).map((rep) => (
                <div key={rep.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{rep.reason}</span>
                      <AdminStateIndicator status={rep.status || 'pending'} />
                    </div>
                    <p className="text-neutral-500 truncate">{rep.details || rep.targetId}</p>
                    {rep.evidence && (
                      <p className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400 break-words rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 px-2 py-1">
                        Reporter-submitted message: {rep.evidence}
                      </p>
                    )}
                    <p className="text-[10px] font-mono uppercase text-neutral-400">{rep.targetType}</p>
                  </div>
                  {rep.status === 'pending' && (
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          await updateDoc(doc(db, 'reports', rep.id), {
                            status: 'resolved',
                            updatedAt: serverTimestamp(),
                          });
                          await onWriteAudit('resolve_messenger_report', 'report', rep.id, 'Resolved safety report');
                          onNotifyAction('Report resolved.');
                        }}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                      >
                        Resolve
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await updateDoc(doc(db, 'reports', rep.id), {
                            status: 'dismissed',
                            updatedAt: serverTimestamp(),
                          });
                          onNotifyAction('Report dismissed.');
                        }}
                        className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </AdminCard>

        <AdminCard className="p-5 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display font-bold text-sm">Messaging & Call Restrictions</h3>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => {
                  setUserSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Filter user..."
                className="h-8 pl-8 pr-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-xs"
              />
            </div>
          </div>

          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {pagedUsers.map((u) => {
              const restricted = Boolean(u.messagingRestricted);
              return (
                <div key={u.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {u.displayName} <span className="font-normal text-neutral-500">@{u.username}</span>
                    </p>
                    <p className="text-[11px] font-mono text-neutral-500">
                      {restricted ? 'Messaging/Calling Restricted' : 'Active Privileges'}
                    </p>
                  </div>
                  {canManageUsers && (
                    <button
                      type="button"
                      onClick={() =>
                        onAskConfirm({
                          title: restricted ? 'Restore Messaging & Calls' : 'Restrict Messaging & Calls',
                          description: `${restricted ? 'Restore' : 'Restrict'} Messenger & WebRTC calling access for @${u.username}?`,
                          confirmLabel: restricted ? 'Restore Access' : 'Restrict Access',
                          variant: restricted ? 'primary' : 'danger',
                          action: () => toggleMessagingRestriction(u),
                        })
                      }
                      className={`px-2.5 py-1 rounded-lg font-semibold ${
                        restricted
                          ? 'bg-emerald-600 text-white'
                          : 'border border-rose-200 dark:border-rose-900 text-rose-600'
                      }`}
                    >
                      {restricted ? 'Restore' : 'Restrict'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <AdminPagination page={page} totalItems={filteredUsers.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </AdminCard>
      </div>
    </div>
  );
}
