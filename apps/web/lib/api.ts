import type { ApiErrorBody, SessionResponse } from '@yucampus/types';
import { collegeSubdomain } from './tenant';

// Empty by default: the browser calls /api/v1 on its own origin and Next forwards it to the API
// (see next.config.ts). Desktop and mobile shells set this to the API's full address instead.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

/** A failed API call. `code` is stable (branch on it); `message` is plain English, ready to show. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The message to show for anything thrown by `api()`. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}

// The access token is kept in memory only. The refresh token is an httpOnly cookie the page cannot read.
let accessToken: string | null = null;
let refreshing: Promise<SessionResponse | null> | null = null;
let onSignedOut: () => void = () => {};

export function setAccessToken(token: string | null) {
  accessToken = token;
}

/** Called when the session has ended and could not be renewed. */
export function setSignedOutHandler(handler: () => void) {
  onSignedOut = handler;
}

async function send(path: string, method: string, body: unknown, withToken: boolean): Promise<Response> {
  const headers: Record<string, string> = { 'x-college': collegeSubdomain() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (withToken && accessToken) headers.authorization = `Bearer ${accessToken}`;
  try {
    return await fetch(`${API_URL}/api/v1${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach YuCampus. Check your internet connection and try again.');
  }
}

async function toError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (body.code && body.message) return new ApiError(response.status, body.code, body.message);
  } catch {
    // Not JSON (for example the API is down behind the proxy): fall through to the generic message.
  }
  return new ApiError(response.status, 'request_failed', 'Something went wrong. Please try again.');
}

/** Renews the session from the refresh cookie. Calls made at the same moment share one request. */
export function refreshSession(): Promise<SessionResponse | null> {
  refreshing ??= (async () => {
    try {
      const response = await send('/auth/refresh', 'POST', undefined, false);
      if (!response.ok) return null;
      const session = (await response.json()) as SessionResponse;
      accessToken = session.accessToken;
      return session;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** false for sign-in routes, which need no access token and must not trigger a refresh. */
  auth?: boolean;
}

async function request(path: string, { method = 'GET', body, auth = true }: Options): Promise<Response> {
  let response = await send(path, method, body, auth);
  if (response.status === 401 && auth) {
    if (await refreshSession()) {
      response = await send(path, method, body, true);
    } else {
      accessToken = null;
      onSignedOut();
    }
  }
  if (!response.ok) throw await toError(response);
  return response;
}

export async function api<T = void>(path: string, options: Options = {}): Promise<T> {
  const response = await request(path, options);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** Saves a file the API sends directly (small generated files, e.g. a blank import sheet). */
export async function apiDownload(path: string, fallbackName: string): Promise<void> {
  const response = await request(path, {});
  const disposition = response.headers.get('content-disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = encoded ? decodeURIComponent(encoded) : fallbackName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
