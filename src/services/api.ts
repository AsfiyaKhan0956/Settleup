// Authentication is carried by the server-issued HttpOnly session cookie.
// Remove tokens left behind by older versions; JavaScript never reads or stores active tokens.
const LEGACY_SESSION_TOKEN_KEY = 'settleup_session_token';
function clearLegacySessionToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
    window.sessionStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
  } catch { /* Storage may be unavailable in private or locked-down contexts. */ }
}
clearLegacySessionToken();

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError('Unable to reach SettleUp. Check your internet or server connection and try again.', 0);
  }

  const contentType = res.headers.get('content-type') || '';
  let data: any = null;
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      if (res.ok) throw new ApiError('The server returned an unreadable response. Please try again.', res.status);
    }
  }

  if (!res.ok) {
    const errMsg = data?.error || `Request failed (${res.status})`;
    if (res.status === 401 && data?.code === 'SESSION_EXPIRED') {
      window.dispatchEvent(new CustomEvent('settleup:session-expired'));
    }
    throw new ApiError(errMsg, res.status, data?.code);
  }

  return data as T;
}

export async function downloadAuthenticatedCsv(url: string, filename: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include' });
  } catch {
    throw new Error('Unable to reach SettleUp to export this report. Check your connection and try again.');
  }
  if (!res.ok) {
    throw new Error(res.status === 401 ? 'Your session has expired. Sign in again to export this report.' : `Unable to export CSV report (${res.status}).`);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
}
