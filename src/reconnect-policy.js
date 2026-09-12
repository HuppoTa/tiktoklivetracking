export class ReconnectController {
  constructor({ cooldownMs, now = Date.now }) {
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.lastStartedAt = 0;
    this.promise = null;
  }

  get inProgress() {
    return Boolean(this.promise);
  }

  get retryAfterMs() {
    if (!this.lastStartedAt) return 0;
    return Math.max(
      0,
      this.cooldownMs -
        (this.now() - this.lastStartedAt),
    );
  }

  request(task) {
    if (this.promise) {
      return {
        state: "joined",
        promise: this.promise,
        retryAfterMs: 0,
      };
    }

    const retryAfterMs =
      this.retryAfterMs;

    if (retryAfterMs > 0) {
      return {
        state: "cooldown",
        promise: null,
        retryAfterMs,
      };
    }

    this.lastStartedAt = this.now();
    const promise = Promise.resolve()
      .then(task);

    this.promise = promise;
    const clear = () => {
      if (this.promise === promise) {
        this.promise = null;
      }
    };
    promise.then(clear, clear);

    return {
      state: "started",
      promise,
      retryAfterMs: 0,
    };
  }
}

export function reconnectBackoffMs(
  failureStreak,
  {
    baseMs,
    maxMs = 30_000,
    jitterMs = 250,
    random = Math.random,
  },
) {
  const attempt = Math.max(
    1,
    Number(failureStreak) || 1,
  );
  const exponential = Math.min(
    maxMs,
    baseMs * 2 ** (attempt - 1),
  );
  const jitter = Math.floor(
    Math.max(0, random()) * jitterMs,
  );
  return exponential + jitter;
}

export function errorSourceMessages(error) {
  const errors =
    error?.config?.requestErrs ||
    error?.roomIdResolutionError
      ?.config?.requestErrs;

  if (!Array.isArray(errors)) {
    return [];
  }

  return errors
    .map((entry) =>
      String(entry?.message || entry),
    )
    .filter(Boolean)
    .slice(0, 5);
}

export function describeConnectionError(
  error,
) {
  const message = String(
    error?.message || error,
  );

  if (
    /unexpected server response:\s*200/i
      .test(message)
  ) {
    return "Dịch vụ TikTok WebSocket tạm từ chối handshake. Hệ thống sẽ tự thử lại.";
  }

  return null;
}

export function isOfflineError(error) {
  return /(?:not live|isn't live|is not live|currently offline|isn't online|is not online|not online|user offline)/i
    .test(String(error?.message || error));
}

export async function connectWithRoomFallback(
  connection,
  cachedRoomId,
  onFallback,
) {
  try {
    return await connection.connect();
  } catch (resolutionError) {
    const roomResolutionFailed =
      /failed to retrieve room id from all sources/i
        .test(String(resolutionError?.message || resolutionError));

    if (!cachedRoomId || !roomResolutionFailed) {
      throw resolutionError;
    }

    onFallback?.(resolutionError);

    try {
      return await connection.connect(
        cachedRoomId,
      );
    } catch (fallbackError) {
      if (
        fallbackError &&
        typeof fallbackError === "object"
      ) {
        fallbackError.roomIdResolutionError =
          resolutionError;
      }
      throw fallbackError;
    }
  }
}
