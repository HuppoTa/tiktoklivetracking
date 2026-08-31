export const legacyEvent = {
  msgId: "legacy-message-1",
  comment: "Cho em hỏi công việc sắp tới thế nào?",
  user: {
    id: "100001",
    uniqueId: "demo.user",
    nickname: "Người dùng A",
    profilePicture: { url: ["https://example.test/a.png"] }
  }
};

export const protobufEvent = {
  common: { msgId: "protobuf-message-1" },
  content: "Tình cảm sắp tới của mình thế nào?",
  user: {
    id: "100002",
    displayId: "sample.user",
    nickname: "Người dùng B",
    avatarThumb: { urlList: ["https://example.test/b.png"] }
  }
};
