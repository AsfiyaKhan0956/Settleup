const SESSION_TOKEN_KEY = 'settleup_session_token';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getStoredSessionToken(): string | null {
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY) || window.sessionStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string | null, rememberMe = true): void {
  try {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
    window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
    if (token) {
      if (rememberMe) {
        window.localStorage.setItem(SESSION_TOKEN_KEY, token);
      } else {
        window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
      }
    }
  } catch {
    // Ignore storage access restrictions in locked-down sandboxes
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredSessionToken();
  const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const res = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
      ...(options.headers ?? {}),
    },
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    const errMsg = data?.error || `Request failed (${res.status})`;
    if (res.status === 401 && data?.code === 'SESSION_EXPIRED') {
      setStoredSessionToken(null);
      window.dispatchEvent(new CustomEvent('settleup:session-expired'));
    }
    throw new ApiError(errMsg, res.status, data?.code);
  }

  return data as T;
}

export async function downloadAuthenticatedCsv(url: string, filename: string): Promise<void> {
  const token = getStoredSessionToken();
  const res = await fetch(url, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error('Unable to export CSV report.');
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}
