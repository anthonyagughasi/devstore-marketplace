export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

export interface FirebaseAuthUserLike {
  uid: string;
  email: string | null;
  displayName: string | null;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
}

export interface FirebaseAuthLike {
  currentUser: FirebaseAuthUserLike | null;
  authStateReady?: () => Promise<void>;
}

export async function parseApiResponse<T = Record<string, any>>(
  res: Response,
  fallbackError: string
): Promise<T> {
  const rawText = await res.text();
  let parsed: Record<string, any> | null = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText) as Record<string, any>;
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const serverCode =
      parsed && typeof parsed.code === 'string' && parsed.code.trim() ? parsed.code.trim() : undefined;
    const serverMessage =
      parsed && typeof parsed.error === 'string' && parsed.error.trim()
        ? parsed.error
        : parsed && typeof parsed.message === 'string' && parsed.message.trim()
        ? parsed.message
        : null;
    throw new ApiRequestError(
      serverMessage || `${fallbackError} (HTTP ${res.status}). Please retry.`,
      res.status,
      serverCode
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new ApiRequestError(
      'The server returned an unexpected non-JSON response. Please retry.',
      res.status || 500
    );
  }

  return parsed as T;
}

export async function getValidatedFirebaseIdToken(
  authInstance: FirebaseAuthLike,
  forceRefresh = true
): Promise<{ user: FirebaseAuthUserLike; token: string } | null> {
  if (typeof authInstance.authStateReady === 'function') {
    await authInstance.authStateReady();
  }

  const currentUser = authInstance.currentUser;
  if (!currentUser) {
    return null;
  }

  const token = (await currentUser.getIdToken(forceRefresh)).trim();
  if (!token || token === 'null' || token === 'undefined' || token.split('.').length !== 3) {
    throw new ApiRequestError(
      'Unable to verify your sign-in session. Please sign in again.',
      401,
      'CLIENT_INVALID_TOKEN'
    );
  }

  return { user: currentUser, token };
}

export async function fetchWithFirebaseAuth<T>(params: {
  url: string;
  authInstance: FirebaseAuthLike;
  buildBody: (user: FirebaseAuthUserLike) => Record<string, unknown>;
  fallbackError: string;
  missingAuthMessage: string;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const {
    url,
    authInstance,
    buildBody,
    fallbackError,
    missingAuthMessage,
    fetchImpl = fetch,
  } = params;

  const sendAttempt = async (forceRefresh: boolean): Promise<T> => {
    const session = await getValidatedFirebaseIdToken(authInstance, forceRefresh);
    if (!session) {
      throw new ApiRequestError(missingAuthMessage, 401, 'AUTH_MISSING');
    }

    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(buildBody(session.user)),
    });

    return parseApiResponse<T>(res, fallbackError);
  };

  try {
    return await sendAttempt(true);
  } catch (err) {
    // Only retry once when the server explicitly signals genuine token expiration.
    if (
      err instanceof ApiRequestError &&
      err.status === 401 &&
      err.code === 'TOKEN_EXPIRED' &&
      authInstance.currentUser
    ) {
      return await sendAttempt(true);
    }
    throw err;
  }
}
