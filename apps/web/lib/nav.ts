import type { Section } from '@yucampus/types';

/** Main navigation (design-reference/screens/Sidebar.dc.html). `icon` is an SVG path on a 24px grid. */
export interface NavItem {
  label: string;
  /** Decides who sees the item (SECTION_ROLES in @yucampus/types). */
  section: Section;
  href: string;
  icon: string;
}

export const NAV: NavItem[] = [
  { label: 'Dashboard', section: 'dashboard', href: '/dashboard', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
  { label: 'Tasks', section: 'tasks', href: '/tasks', icon: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2' },
  {
    label: 'Evidence library',
    section: 'evidence',
    href: '/evidence',
    icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  },
  {
    label: 'Data registers',
    section: 'registers',
    href: '/registers',
    icon: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  },
  { label: 'NAAC', section: 'naac', href: '/naac', icon: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z' },
  { label: 'NBA', section: 'nba', href: '/nba', icon: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5' },
  { label: 'NIRF', section: 'nirf', href: '/nirf', icon: 'M4 20V10M10 20V4M16 20v-8M2 20h20' },
  { label: 'AISHE', section: 'aishe', href: '/aishe', icon: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9' },
  { label: 'Review queue', section: 'review', href: '/review', icon: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM8 12l3 3 5-6' },
  {
    label: 'Surveys',
    section: 'surveys',
    href: '/surveys',
    icon: 'M8 10h8M8 14h5M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z',
  },
  {
    label: 'Reports',
    section: 'reports',
    href: '/reports',
    icon: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  },
  {
    label: 'Notifications',
    section: 'notifications',
    href: '/notifications',
    icon: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  },
  {
    label: 'Users and roles',
    section: 'users',
    href: '/users',
    icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  },
  { label: 'Institution setup', section: 'setup', href: '/setup', icon: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12' },
  { label: 'Audit log', section: 'audit', href: '/audit', icon: 'M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5' },
];
