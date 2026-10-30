/** Colleges live at <subdomain>.ROOT_DOMAIN (decided 2026-10-30: a subdomain of Yubhian's own domain). */
export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'yubhiantechnologies.in';
const DEFAULT_COLLEGE = process.env.NEXT_PUBLIC_DEFAULT_COLLEGE ?? 'sample';

/**
 * Which college this browser tab is for, from the web address: abc.yubhiantechnologies.in -> "abc".
 * On plain localhost it is the sample college. The API only uses this before sign-in; after that the
 * college comes from the signed-in user, so changing it cannot reach another college's data.
 */
export function collegeSubdomain(): string {
  if (typeof window === 'undefined') return DEFAULT_COLLEGE;
  const host = window.location.hostname.toLowerCase();
  for (const root of [ROOT_DOMAIN, 'localhost']) {
    if (host.endsWith(`.${root}`)) return host.slice(0, -(root.length + 1));
  }
  return DEFAULT_COLLEGE;
}
