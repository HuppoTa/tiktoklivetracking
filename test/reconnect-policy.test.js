import test from "node:test";
import assert from "node:assert/strict";
import {
  connectWithRoomFallback,
  describeConnectionError,
  errorSourceMessages,
  isOfflineError,
  reconnectBackoffMs,
  ReconnectController,
} from "../src/reconnect-policy.js";

test("reconnect đồng thời dùng chung một lần chạy", async () => {
  let now = 10_000;
  let calls = 0;
  let finish;
  const controller = new ReconnectController({
    cooldownMs: 10_000,
    now: () => now,
  });
  const task = () => {
    calls += 1;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };

  const first = controller.request(task);
  const second = controller.request(task);

  assert.equal(first.state, "started");
  assert.equal(second.state, "joined");
  assert.equal(first.promise, second.promise);
  await Promise.resolve();
  assert.equal(calls, 1);

  finish({ ok: true });
  await first.promise;
  now += 1;

  const cooldown = controller.request(task);
  assert.equal(cooldown.state, "cooldown");
  assert.equal(cooldown.retryAfterMs, 9_999);
  assert.equal(calls, 1);
});

test("backoff tăng dần, có giới hạn và jitter", () => {
  const options = {
    baseMs: 5_000,
    maxMs: 30_000,
    jitterMs: 250,
    random: () => 0.5,
  };

  assert.equal(reconnectBackoffMs(1, options), 5_125);
  assert.equal(reconnectBackoffMs(2, options), 10_125);
  assert.equal(reconnectBackoffMs(3, options), 20_125);
  assert.equal(reconnectBackoffMs(4, options), 30_125);
  assert.equal(reconnectBackoffMs(20, options), 30_125);
});

test("chi tiết lỗi của từng nguồn Room ID được giữ lại", () => {
  const error = {
    config: {
      requestErrs: [
        new Error("HTML bị TikTok chặn"),
        new Error("API không trả room ID"),
        new Error("Euler không có quyền"),
      ],
    },
  };

  assert.deepEqual(
    errorSourceMessages(error),
    [
      "HTML bị TikTok chặn",
      "API không trả room ID",
      "Euler không có quyền",
    ],
  );
});

test("Room ID gần nhất chỉ fallback sau lỗi resolver", async () => {
  const calls = [];
  const sourceError = new Error(
    "Failed to retrieve Room ID from all sources.",
  );
  sourceError.config = {
    requestErrs: [new Error("HTML blocked")],
  };
  const connection = {
    async connect(roomId) {
      calls.push(roomId || null);
      if (!roomId) throw sourceError;
      return { roomId };
    },
  };
  let fallbackError = null;

  const result = await connectWithRoomFallback(
    connection,
    "room-cached",
    (error) => {
      fallbackError = error;
    },
  );

  assert.deepEqual(calls, [null, "room-cached"]);
  assert.equal(result.roomId, "room-cached");
  assert.equal(fallbackError, sourceError);
});

test("không dùng Room ID cũ cho lỗi kết nối khác", async () => {
  const calls = [];
  const connection = {
    async connect(roomId) {
      calls.push(roomId || null);
      throw new Error("WebSocket handshake failed");
    },
  };

  await assert.rejects(
    connectWithRoomFallback(
      connection,
      "room-cached",
    ),
    /handshake failed/,
  );
  assert.deepEqual(calls, [null]);
});

test("WebSocket HTTP 200 báo lỗi handshake dễ hiểu", () => {
  const error = new Error(
    "Unexpected server response: 200",
  );

  assert.match(
    describeConnectionError(error),
    /tạm từ chối handshake/,
  );
  assert.equal(
    describeConnectionError(
      new Error("Room offline"),
    ),
    null,
  );
});

test("nhận diện đầy đủ thông báo tài khoản không còn LIVE", () => {
  assert.equal(
    isOfflineError(
      new Error("The requested user isn't online :("),
    ),
    true,
  );
  assert.equal(
    isOfflineError(
      new Error("User is currently offline"),
    ),
    true,
  );
  assert.equal(
    isOfflineError(
      new Error("Unexpected server response: 200"),
    ),
    false,
  );
});
