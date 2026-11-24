import type { AdminRoleType } from '@/src/types/bana';

export type AdminModuleId =
  | 'overview'
  | 'alerts'
  | 'users'
  | 'verifications'
  | 'paid_verifications'
  | 'friend_suggestions'
  | 'smart_video'
  | 'content'
  | 'storage_recovery'
  | 'messenger_calling'
  | 'api_management'
  | 'marketplace'
  | 'communities'
  | 'monetization'
  | 'ads'
  | 'finance'
  | 'reports'
  | 'notifications'
  | 'platform_settings'
  | 'admin_roles'
  | 'audit_logs';

export type AdminSensitiveAction =
  | 'manage_users'
  | 'moderate_content'
  | 'manage_storage_recovery'
  | 'manage_verifications'
  | 'manage_paid_verifications'
  | 'manage_friend_suggestions'
  | 'manage_video_distribution_settings'
  | 'moderate_video_distribution'
  | 'manage_verification_payment_settings'
  | 'manage_communities'
  | 'transfer_community_owner'
  | 'manage_marketplace'
  | 'manage_monetization_apps'
  | 'manage_ads'
  | 'manage_finance'
  | 'manage_platform_settings'
  | 'manage_calling_settings'
  | 'manage_api_providers'
  | 'assign_admin_roles'
  | 'dispatch_notifications';

export interface AdminRoleDefinition {
  role: AdminRoleType;
  label: string;
  summary: string;
  modules: AdminModuleId[];
  actions: AdminSensitiveAction[];
}

export const ADMIN_ROLE_DEFINITIONS: Record<AdminRoleType, AdminRoleDefinition> = {
  super_admin: {
    role: 'super_admin',
    label: 'Super Admin',
    summary: 'Unrestricted platform governance, RBAC role assignments, finance approvals, and critical overrides.',
    modules: [
      'smart_video',
      'paid_verifications',
      'friend_suggestions',
      'overview',
      'alerts',
      'users',
      'verifications',
      'content',
      'storage_recovery',
      'messenger_calling',
      'api_management',
      'marketplace',
      'communities',
      'monetization',
      'ads',
      'finance',
      'reports',
      'notifications',
      'platform_settings',
      'admin_roles',
      'audit_logs',
    ],
    actions: [
      'manage_video_distribution_settings',
      'moderate_video_distribution',
      'manage_paid_verifications',
      'manage_friend_suggestions',
      'manage_verification_payment_settings',
      'manage_users',
      'moderate_content',
      'manage_storage_recovery',
      'manage_verifications',
      'manage_communities',
      'transfer_community_owner',
      'manage_marketplace',
      'manage_monetization_apps',
      'manage_ads',
      'manage_finance',
      'manage_platform_settings',
      'manage_calling_settings',
      'manage_api_providers',
      'assign_admin_roles',
      'dispatch_notifications',
    ],
  },
  admin: {
    role: 'admin',
    label: 'Admin',
    summary: 'Full operational control across users, content, marketplace, communities, monetization, ads, and settings.',
    modules: [
      'smart_video',
      'paid_verifications',
      'friend_suggestions',
      'overview',
      'alerts',
      'users',
      'verifications',
      'content',
      'storage_recovery',
      'messenger_calling',
      'api_management',
      'marketplace',
      'communities',
      'monetization',
      'ads',
      'reports',
      'notifications',
      'platform_settings',
      'audit_logs',
    ],
    actions: [
      'manage_video_distribution_settings',
      'moderate_video_distribution',
      'manage_paid_verifications',
      'manage_friend_suggestions',
      'manage_users',
      'moderate_content',
      'manage_storage_recovery',
      'manage_verifications',
      'manage_communities',
      'transfer_community_owner',
      'manage_marketplace',
      'manage_monetization_apps',
      'manage_ads',
      'manage_platform_settings',
      'manage_calling_settings',
      'manage_api_providers',
      'dispatch_notifications',
    ],
  },
  moderator: {
    role: 'moderator',
    label: 'Moderator',
    summary: 'Safety triage across reports, posts, reels, stories, comments, groups, marketplace, and account restrictions.',
    modules: [
      'smart_video',
      'overview',
      'alerts',
      'users',
      'verifications',
      'content',
      'messenger_calling',
      'marketplace',
      'communities',
      'reports',
      'audit_logs',
    ],
    actions: [
      'moderate_video_distribution',
      'manage_users',
      'moderate_content',
      'manage_verifications',
      'manage_communities',
      'manage_marketplace',
    ],
  },
  support_staff: {
    role: 'support_staff',
    label: 'Support Staff',
    summary: 'Handles account verifications, user standing reviews, dispute context, and abuse report follow-ups.',
    modules: [
      'overview',
      'alerts',
      'users',
      'verifications',
      'messenger_calling',
      'marketplace',
      'reports',
      'notifications',
    ],
    actions: ['manage_verifications', 'dispatch_notifications'],
  },
  finance_manager: {
    role: 'finance_manager',
    label: 'Finance Staff',
    summary: 'Exclusive authority over creator earnings, payouts, advertiser billing, refunds, and boost approvals.',
    modules: ['paid_verifications', 'overview', 'alerts', 'monetization', 'finance', 'marketplace', 'ads', 'audit_logs'],
    actions: ['manage_paid_verifications', 'manage_finance', 'manage_monetization_apps'],
  },
  ad_manager: {
    role: 'ad_manager',
    label: 'Advertisement Manager',
    summary: 'Manages advertisers, campaign review approvals, creatives, reported ads, and ad pricing/frequency policies.',
    modules: ['overview', 'alerts', 'ads', 'reports', 'audit_logs'],
    actions: ['manage_ads'],
  },
  content_manager: {
    role: 'content_manager',
    label: 'Content Manager',
    summary: 'Manages posts, reels, comments, communities and content-related ad/creative review. No finance, user-standing or settings access.',
    modules: ['overview', 'alerts', 'content', 'communities', 'ads', 'reports', 'audit_logs'],
    actions: ['moderate_content', 'manage_communities', 'manage_ads'],
  },
  support_manager: {
    role: 'support_manager',
    label: 'Support Manager (Legacy)',
    summary: 'Legacy support operations role mapped to verifications, reports, and user assistance.',
    modules: ['overview', 'alerts', 'users', 'verifications', 'messenger_calling', 'reports', 'notifications'],
    actions: ['manage_verifications', 'dispatch_notifications'],
  },
};

export const PRIMARY_ADMIN_ROLES: AdminRoleType[] = [
  'super_admin',
  'admin',
  'moderator',
  'support_staff',
  'finance_manager',
  'content_manager',
  'ad_manager',
];

export function canAccessAdminModule(role: AdminRoleType | null, moduleId: AdminModuleId): boolean {
  if (!role) return false;
  const def = ADMIN_ROLE_DEFINITIONS[role];
  if (!def) return false;
  return def.modules.includes(moduleId);
}

export function canPerformAdminAction(role: AdminRoleType | null, action: AdminSensitiveAction): boolean {
  if (!role) return false;
  const def = ADMIN_ROLE_DEFINITIONS[role];
  if (!def) return false;
  return def.actions.includes(action);
}

export function getAdminRoleLabel(role: AdminRoleType | null | undefined): string {
  if (!role) return 'None';
  return ADMIN_ROLE_DEFINITIONS[role]?.label || role.replace(/_/g, ' ');
}

export function isCriticalSuperAdminAction(action: AdminSensitiveAction): boolean {
  return action === 'assign_admin_roles' || action === 'manage_finance' || action === 'manage_platform_settings';
}

/**
 * Prompt 09 — administrative alert routing.
 * An alert is shown to a staff member only when they can open the module that resolves it.
 */
export type AdminAlertKind =
  | 'reports'
  | 'verifications'
  | 'monetization'
  | 'payouts'
  | 'ads'
  | 'marketplace'
  | 'service';

export const ADMIN_ALERT_MODULE: Record<AdminAlertKind, AdminModuleId> = {
  reports: 'reports',
  verifications: 'verifications',
  monetization: 'monetization',
  payouts: 'finance',
  ads: 'ads',
  marketplace: 'marketplace',
  service: 'platform_settings',
};

export function canSeeAdminAlert(role: AdminRoleType | null, kind: AdminAlertKind): boolean {
  return canAccessAdminModule(role, ADMIN_ALERT_MODULE[kind]);
}
