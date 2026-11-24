import React, { useEffect, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { DEFAULT_PLATFORM_SETTINGS } from '@/src/contexts/AuthContext';
import { AdminCard } from '@/src/components/admin/AdminShared';
import type { MarketplacePolicySettings, PlatformSettings, PostVisibility } from '@/src/types/bana';

interface AdminPlatformSettingsSectionProps {
  initialSettings: PlatformSettings;
  initialMarketPolicy: MarketplacePolicySettings;
  canEditPlatformSettings: boolean;
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

export function AdminPlatformSettingsSection({
  initialSettings,
  initialMarketPolicy,
  canEditPlatformSettings,
  onWriteAudit,
  onNotifyAction,
  onAskConfirm,
}: AdminPlatformSettingsSectionProps) {
  const [form, setForm] = useState<PlatformSettings>({ ...DEFAULT_PLATFORM_SETTINGS, ...initialSettings });
  const [mktPolicy, setMktPolicy] = useState<MarketplacePolicySettings>(initialMarketPolicy);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({ ...DEFAULT_PLATFORM_SETTINGS, ...initialSettings });
  }, [initialSettings]);

  useEffect(() => {
    setMktPolicy(initialMarketPolicy);
  }, [initialMarketPolicy]);

  const persistPlatform = async () => {
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'adminSettings', 'platform'),
        {
          ...form,
          platformName: form.platformName.trim() || 'BANA',
          tagline: form.tagline.trim() || 'Discover More. Connect Better.',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await setDoc(
        doc(db, 'adminSettings', 'marketplace'),
        {
          ...mktPolicy,
          id: 'marketplace',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await onWriteAudit(
        'update_platform_settings',
        'adminSettings',
        'platform',
        `Saved platform branding, auth, privacy, policies, maintenance=${form.maintenanceMode}`
      );
      onNotifyAction('Platform & Marketplace settings applied live.');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (!canEditPlatformSettings) return;
    if (form.maintenanceMode && !initialSettings.maintenanceMode) {
      onAskConfirm({
        title: 'Enable Platform Maintenance Mode',
        description:
          'This displays a live Maintenance Notice across BANA for non-admin users. Administrators keep full panel access.',
        confirmLabel: 'Enable Maintenance & Save',
        variant: 'danger',
        action: persistPlatform,
      });
      return;
    }
    void persistPlatform();
  };

  return (
    <div className="space-y-4">
      <AdminCard className="p-5 space-y-5">
        <div>
          <h2 className="font-display font-bold text-lg">Platform Identity, SEO & Live Configuration</h2>
          <p className="text-xs text-neutral-500">
            Stored in `adminSettings/platform` and synchronized across all active BANA sessions in real time.
          </p>
        </div>

        {/* 1. Branding & SEO */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
          <div className="space-y-1">
            <label className="font-medium block">Platform Name</label>
            <input
              type="text"
              disabled={!canEditPlatformSettings}
              value={form.platformName}
              onChange={(e) => setForm((f) => ({ ...f, platformName: e.target.value }))}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium block">Tagline</label>
            <input
              type="text"
              disabled={!canEditPlatformSettings}
              value={form.tagline}
              onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium block">Browser Website Title</label>
            <input
              type="text"
              disabled={!canEditPlatformSettings}
              value={form.websiteTitle || ''}
              onChange={(e) => setForm((f) => ({ ...f, websiteTitle: e.target.value }))}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium block">Logo URL (optional)</label>
            <input
              type="url"
              disabled={!canEditPlatformSettings}
              value={form.logoUrl || ''}
              onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
              placeholder="https://..."
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium block">Favicon URL (optional)</label>
            <input
              type="url"
              disabled={!canEditPlatformSettings}
              value={form.faviconUrl || ''}
              onChange={(e) => setForm((f) => ({ ...f, faviconUrl: e.target.value }))}
              placeholder="https://..."
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
            />
          </div>
          <div className="space-y-1">
            <label className="font-medium block">Website Meta Description</label>
            <input
              type="text"
              disabled={!canEditPlatformSettings}
              value={form.websiteDescription || ''}
              onChange={(e) => setForm((f) => ({ ...f, websiteDescription: e.target.value }))}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
            />
          </div>
        </div>

        {/* 2. Authentication & Feature Toggles */}
        <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800 space-y-3">
          <h3 className="font-display font-bold text-sm">Authentication & Feature Controls</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
            {[
              { key: 'registrationOpen', label: 'New User Registrations Open' },
              { key: 'allowGoogleSignIn', label: 'Allow Google OAuth Sign-In' },
              { key: 'allowEmailPasswordSignIn', label: 'Allow Email/Password Auth' },
              { key: 'requireEmailVerification', label: 'Require Email Verification' },
              { key: 'enableReels', label: 'Enable Reels & Video Feed' },
              { key: 'enableMarketplace', label: 'Enable BANA Marketplace' },
              { key: 'enableCommunities', label: 'Enable Communities & Groups' },
              { key: 'enableMessaging', label: 'Enable Messenger Chat' },
              { key: 'enableCalling', label: 'Enable Audio & Video Calling' },
              { key: 'enableMonetization', label: 'Enable Creator Monetization' },
              { key: 'enableAds', label: 'Enable Advertisement Manager' },
            ].map((item) => (
              <label
                key={item.key}
                className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950"
              >
                <span className="font-medium pr-2">{item.label}</span>
                <input
                  type="checkbox"
                  disabled={!canEditPlatformSettings}
                  checked={Boolean((form as any)[item.key] !== false)}
                  onChange={(e) => setForm((f) => ({ ...f, [item.key]: e.target.checked }))}
                  className="accent-[#1877F2]"
                />
              </label>
            ))}
          </div>
        </div>

        {/* 3. Default Privacy & Notification Settings */}
        <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800 space-y-3 text-xs">
          <h3 className="font-display font-bold text-sm">New Account Privacy & Notification Defaults</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="font-medium block">Default Post Visibility</label>
              <select
                disabled={!canEditPlatformSettings}
                value={form.defaultPostVisibility || 'public'}
                onChange={(e) => setForm((f) => ({ ...f, defaultPostVisibility: e.target.value as PostVisibility }))}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              >
                <option value="public">Public</option>
                <option value="followers">Followers</option>
                <option value="friends">Friends</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="font-medium block">Default Messaging Privacy</label>
              <select
                disabled={!canEditPlatformSettings}
                value={form.defaultMessagePrivacy || 'everyone'}
                onChange={(e) => setForm((f) => ({ ...f, defaultMessagePrivacy: e.target.value as any }))}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              >
                <option value="everyone">Everyone</option>
                <option value="followers">Followers</option>
                <option value="friends">Friends Only</option>
              </select>
            </div>
            <label className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950 self-end h-10">
              <span className="font-medium">Default Private Accounts</span>
              <input
                type="checkbox"
                disabled={!canEditPlatformSettings}
                checked={Boolean(form.defaultAccountPrivate)}
                onChange={(e) => setForm((f) => ({ ...f, defaultAccountPrivate: e.target.checked }))}
                className="accent-[#1877F2]"
              />
            </label>
            <label className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950">
              <span className="font-medium">Default Push / In-App Alerts</span>
              <input
                type="checkbox"
                disabled={!canEditPlatformSettings}
                checked={form.defaultPushNotifications !== false}
                onChange={(e) => setForm((f) => ({ ...f, defaultPushNotifications: e.target.checked }))}
                className="accent-[#1877F2]"
              />
            </label>
            <label className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950">
              <span className="font-medium">Default Marketplace/Finance Alerts</span>
              <input
                type="checkbox"
                disabled={!canEditPlatformSettings}
                checked={form.defaultEmailNotifications !== false}
                onChange={(e) => setForm((f) => ({ ...f, defaultEmailNotifications: e.target.checked }))}
                className="accent-[#1877F2]"
              />
            </label>
          </div>
        </div>

        {/* 4. Policies, Guidelines & Marketplace Policy */}
        <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800 space-y-3 text-xs">
          <h3 className="font-display font-bold text-sm">Content Policies, Community Guidelines & Marketplace Rules</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-medium block">Platform Content Policy Summary</label>
              <textarea
                rows={3}
                disabled={!canEditPlatformSettings}
                value={form.contentPolicyText || ''}
                onChange={(e) => setForm((f) => ({ ...f, contentPolicyText: e.target.value }))}
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3"
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium block">Community Guidelines Summary</label>
              <textarea
                rows={3}
                disabled={!canEditPlatformSettings}
                value={form.communityGuidelinesText || ''}
                onChange={(e) => setForm((f) => ({ ...f, communityGuidelinesText: e.target.value }))}
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="font-medium block">Free Seller Listing Quota</label>
              <input
                type="number"
                min={1}
                disabled={!canEditPlatformSettings}
                value={mktPolicy.freeListingsLimit}
                onChange={(e) => setMktPolicy((m) => ({ ...m, freeListingsLimit: Number(e.target.value) || 3 }))}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium block">Buyer Dispute Window (Days)</label>
              <input
                type="number"
                min={1}
                disabled={!canEditPlatformSettings}
                value={mktPolicy.buyerDisputeWindowDays}
                onChange={(e) => setMktPolicy((m) => ({ ...m, buyerDisputeWindowDays: Number(e.target.value) || 7 }))}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
              />
            </div>
            <label className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950 self-end h-10">
              <span className="font-medium">Require Listing Pre-Approval</span>
              <input
                type="checkbox"
                disabled={!canEditPlatformSettings}
                checked={mktPolicy.requireListingApproval}
                onChange={(e) => setMktPolicy((m) => ({ ...m, requireListingApproval: e.target.checked }))}
                className="accent-[#1877F2]"
              />
            </label>
          </div>
        </div>

        {/* 5. Maintenance & Announcement Banner */}
        <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800 space-y-3 text-xs">
          <h3 className="font-display font-bold text-sm">Maintenance Mode & Platform Announcement Banner</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-2 p-3 rounded-xl border border-neutral-200 dark:border-neutral-800">
              <label className="flex items-center justify-between font-semibold">
                <span>Maintenance Mode Active</span>
                <input
                  type="checkbox"
                  disabled={!canEditPlatformSettings}
                  checked={Boolean(form.maintenanceMode)}
                  onChange={(e) => setForm((f) => ({ ...f, maintenanceMode: e.target.checked }))}
                  className="accent-rose-600"
                />
              </label>
              <input
                type="text"
                disabled={!canEditPlatformSettings}
                value={form.maintenanceMessage || ''}
                onChange={(e) => setForm((f) => ({ ...f, maintenanceMessage: e.target.value }))}
                placeholder="Maintenance notice displayed to members..."
                className="w-full h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              />
            </div>

            <div className="space-y-2 p-3 rounded-xl border border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    disabled={!canEditPlatformSettings}
                    checked={Boolean(form.announcementEnabled)}
                    onChange={(e) => setForm((f) => ({ ...f, announcementEnabled: e.target.checked }))}
                    className="accent-[#1877F2]"
                  />
                  <span>Show Global Announcement Banner</span>
                </label>
                <select
                  disabled={!canEditPlatformSettings}
                  value={form.announcementSeverity || 'info'}
                  onChange={(e) => setForm((f) => ({ ...f, announcementSeverity: e.target.value as any }))}
                  className="h-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2"
                >
                  <option value="info">Info (Blue)</option>
                  <option value="warning">Warning (Amber)</option>
                  <option value="alert">Urgent (Rose)</option>
                </select>
              </div>
              <input
                type="text"
                disabled={!canEditPlatformSettings}
                value={form.announcementMessage || ''}
                onChange={(e) => setForm((f) => ({ ...f, announcementMessage: e.target.value }))}
                placeholder="Global announcement message..."
                className="w-full h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              />
            </div>
          </div>
        </div>

        {canEditPlatformSettings && (
          <div className="pt-2 flex justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-5 py-2.5 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold disabled:opacity-60"
            >
              {saving ? 'Applying Settings...' : 'Save & Apply Live Settings'}
            </button>
          </div>
        )}
      </AdminCard>
    </div>
  );
}
