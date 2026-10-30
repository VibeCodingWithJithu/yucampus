import type { CollegeType, Role, UserStatus } from './index.js';
import type { Grant } from './permissions.js';

/** One duty a person holds. `departmentId` is set for department-scoped duties such as HOD. */
export interface RoleAssignment {
  role: Role;
  departmentId: string | null;
}

/** The signed-in person, as returned by GET /auth/me. */
export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  status: UserStatus;
  roles: RoleAssignment[];
  /** What this person may do, worked out on the server from roles, templates and the college's adjustments. */
  permissions: Grant[];
  college: {
    id: string;
    name: string;
    type: CollegeType;
    subdomain: string;
  };
}

/** Returned by sign-in and refresh. The refresh token travels in an httpOnly cookie, never in this body. */
export interface SessionResponse {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: SessionUser;
}

/** Shape of every API error body. `code` is stable and safe to branch on; `message` is ready to show. */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
}
