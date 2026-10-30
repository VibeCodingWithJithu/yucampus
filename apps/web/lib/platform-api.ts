import type { PlatformSession } from '@yucampus/types';
import { ApiError } from './api';

// The YuCampus team panel's own API client (docs/ARCHITECTURE.md "Platform panel"). Separate from lib/api.ts:
// its own in-memory token and refresh cookie, and no college header. College and team sessions never mix.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

let accessToken: string | null = null;
let refreshing: Promise<PlatformSession | null> | null = null;
let onSignedOut: () => void = () => {};

export function setPlatformToken(token: string | null) {
  accessToken = token;
}

export function setPlatformSignedOutHandler(handler: () => void) {
  onSignedOut = handler;
}

async function send(path: string, method: string, body: unknown, withToken: boolean): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (withToken && accessToken) headers.authorization = `Bearer ${accessToken}`;
  try {
    return await fetch(`${API_URL}/api/v1/platform${path}`, {
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
    const body = (await response.json()) as { code?: string; message?: string };
    if (body.code && body.message) return new ApiError(response.status, body.code, body.message);
  } catch {
    // Not JSON: fall through.
  }
  return new ApiError(response.status, 'request_failed', 'Something went wrong. Please try again.');
}

export function refreshPlatformSession(): Promise<PlatformSession | null> {
  refreshing ??= (async () => {
    try {
      const response = await send('/auth/refresh', 'POST', undefined, false);
      if (!response.ok) return null;
      const session = (await response.json()) as PlatformSession;
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
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
}

export async function platformApi<T = void>(path: string, { method = 'GET', body, auth = true }: Options = {}): Promise<T> {
  let response = await send(path, method, body, auth);
  if (response.status === 401 && auth) {
    if (await refreshPlatformSession()) {
      response = await send(path, method, body, true);
    } else {
      accessToken = null;
      onSignedOut();
    }
  }
  if (!response.ok) throw await toError(response);
  return (response.status === 204 ? undefined : await response.json()) as T;
}
