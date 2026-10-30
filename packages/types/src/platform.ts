import type { CollegeType } from './index.js';

// The platform panel for the YuCampus team (decided 2026-10-18). Separate accounts and tokens from colleges.
// What the team sees of a college is metadata and counts only: never evidence, records or answers (DPDP Act).

export type PlatformAdminStatus = 'active' | 'invited' | 'disabled';
export type CollegeStatus = 'active' | 'suspended';

export interface PlatformAdminView {
  id: string;
  email: string;
  name: string;
  status: PlatformAdminStatus;
  /** Has set up their authenticator app. */
  mfa: boolean;
  lastSignInAt: string | null;
  createdAt: string;
}

export interface PlatformSession {
  accessToken: string;
  expiresIn: number;
  admin: PlatformAdminView;
  /** Only right after setting up the authenticator app: shown once, never again. */
  recoveryCodes?: string[];
}

/**
 * The second sign-in step (decided 2026-10-21). The ticket lasts 5 minutes and opens nothing but this step.
 * enroll: the person has no authenticator yet and sets it up now with this secret.
 */
export interface PlatformChallenge {
  step: 'code' | 'enroll';
  ticket: string;
  enroll?: { secret: string; otpauthUrl: string };
}

export interface PlatformCollegeRow {
  id: string;
  name: string;
  type: CollegeType;
  subdomain: string;
  state: string;
  plan: string;
  status: CollegeStatus;
  createdAt: string;
  users: number;
  /** People who signed in during the last 30 days. */
  activeUsers: number;
  evidence: number;
  /** Bytes of evidence files, all versions. */
  storageBytes: number;
  registerRecords: number;
  lastActivityAt: string | null;
}

export interface PlatformCollegeDetail extends PlatformCollegeRow {
  /** The web address of the college. */
  url: string;
  city: string | null;
  aisheCode: string | null;
  /** College admins and the principal: who to contact. */
  contacts: { name: string; email: string | null; mobile: string | null; role: string; status: string }[];
  frameworks: { code: string; name: string; body: string }[];
  /** The latest platform actions about this college. */
  history: PlatformAuditEntry[];
}

export interface PlatformRuleFramework {
  code: string;
  version: string;
  name: string;
  body: string;
  status: string;
  verified: boolean;
  /** Colleges that use it (college-wide or for a program). */
  colleges: number;
}

export interface PlatformRuleFile {
  area: string;
  file: string;
  version: string;
  title: string;
  verified: boolean;
}

export interface PlatformRulesView {
  frameworks: PlatformRuleFramework[];
  registers: { code: string; version: string; name: string; status: string; verified: boolean }[];
  files: PlatformRuleFile[];
}

export interface PlatformAuditEntry {
  id: string;
  at: string;
  admin: { id: string; name: string } | null;
  action: string;
  actionLabel: string;
  college: { id: string; name: string } | null;
  detail: Record<string, unknown>;
}

const PLATFORM_ACTIONS: Record<string, string> = {
  sign_in: 'Signed in',
  college_create: 'Set up a college',
  college_suspend: 'Suspended a college',
  college_reactivate: 'Reactivated a college',
  college_plan: 'Changed a plan',
  college_resend_invite: 'Sent the college admin invite again',
  admin_invite: 'Invited a team member',
  admin_disable: 'Disabled a team member',
  admin_enable: 'Enabled a team member',
  admin_reset: 'Sent a password link',
  admin_reset_mfa: 'Reset an authenticator',
  mfa_enrolled: 'Set up the authenticator app',
  recovery_code_used: 'Signed in with a recovery code',
  password_chosen: 'Chose a password',
};

export function platformActionLabel(action: string): string {
  return PLATFORM_ACTIONS[action] ?? action.replace(/_/g, ' ');
}

/** Subdomains a college can never take (they are YuCampus's own addresses). */
export const RESERVED_SUBDOMAINS = ['admin', 'auth', 'api', 'app', 'www', 'mail', 'static', 'cdn', 'help', 'support', 'status', 'docs', 'demo'] as const;
