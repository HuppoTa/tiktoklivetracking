import {
  detectTopics,
  extractDates,
  normalizeText,
} from "./normalize.js";

export const QUESTION_THRESHOLD = 0.60;

const ASK =
  /\b(khong|ko|k|hong|hoh|hok|hem|khum|kg|chua|sao|gi|nao|bao gio|bao lau|khi nao|co khong|duoc khong|con khong|the nao|nhu the nao|ra sao)\b/;

const REQUEST =
  /\b(xem giup|xem dum|xem cho em|xem em voi|xem minh voi|coi giup|coi dum|coi cho|coi em voi|trai bai|trai giup|xin xem|cho em hoi|chi xem|anh xem)\b/;

const FUTURE =
  /\b(sap toi|thang toi|nam nay|tuong lai|quay lai|con duyen|tiep tuc|di tiep|tai hop)\b/;

const POLITE_ENDING =
  /\b(a|ah|nha|nhe)\b(?:\s|[^\p{L}\p{N}])*$/u;

const NEGATIVE =
  /^(hi|hello|chao chi|em chao chi|xinh qua|hay qua|dung roi|cam on chi|cam on chi a)$/;

/**
 * Chuẩn hóa cách viết tắt thường gặp trên TikTok LIVE.
 *
 * Ví dụ:
 * qlai hoh ạ -> quay lai khong a
 * QL ko      -> quay lai khong
 * ctay chưa  -> chia tay chua
 */
function expandTikTokAliases(text) {
  let value = String(text ?? "");

  const aliases = [
    // Quay lại
    [/\bqlai\b/g, "quay lai"],
    [/\bq\s*lai\b/g, "quay lai"],
    [/\bql\b/g, "quay lai"],

    // Chia tay
    [/\bctay\b/g, "chia tay"],
    [/\bchiatay\b/g, "chia tay"],
    [/\bc\s*tay\b/g, "chia tay"],

    // Không
    [/\bhoh\b/g, "khong"],
    [/\bhong\b/g, "khong"],
    [/\bhok\b/g, "khong"],
    [/\bhem\b/g, "khong"],
    [/\bkhum\b/g, "khong"],
    [/\bkg\b/g, "khong"],

    // Được / được không
    [/\bdk\b/g, "duoc khong"],
    [/\bdc\b/g, "duoc"],

    // Cách hỏi rút gọn
    [/\bntn\b/g, "nhu the nao"],
    [/\bbh\b/g, "bao gio"],

    // Quan hệ
    [/\bnyc\b/g, "nguoi yeu cu"],
    [/\bny\b/g, "nguoi yeu"],

    // Chủ đề
    [/\btcam\b/g, "tinh cam"],
    [/\bt\s*\/\s*cam\b/g, "tinh cam"],
    [/\bt\s+cam\b/g, "tinh cam"],
    [/\btduyen\b/g, "tinh duyen"],
  ];

  for (const [pattern, replacement] of aliases) {
    value = value.replace(pattern, replacement);
  }

  return value.replace(/\s+/g, " ").trim();
}

export function classifyQuestion(
  text,
  { forced = false, system = false } = {},
) {
  const raw = String(text ?? "").trim();

  const folded = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

  /*
   * Alias phải được mở rộng trước khi chạy:
   * - normalizeText()
   * - detectTopics()
   * - ASK
   * - FUTURE
   */
  const expanded = expandTikTokAliases(folded);
  const normalized = normalizeText(expanded);

  if (forced) {
    return {
      question: true,
      score: 1,
      reasons: ["tiktok-question-event"],
    };
  }

  if (!raw || system) {
    return {
      question: false,
      score: 0,
      reasons: [
        system
          ? "system-comment"
          : "empty",
      ],
    };
  }

  const reasons = [];
  let score = 0;

  const topics = detectTopics(normalized);
  const dates = extractDates(normalized);

  const relationshipAlias =
    /\b(tcam|t\s*\/\s*cam|t\s+cam|tduyen)\b/u.test(folded);

  const breakupOrReturnAlias =
    /\b(qlai|q\s*lai|ql|ctay|chiatay|c\s*tay)\b/u.test(folded);

  const firstDigitIndex = raw.search(/\d/);

  const textBeforeFirstDate =
    firstDigitIndex >= 0
      ? raw.slice(0, firstDigitIndex)
      : raw;

  const personPattern =
    dates.length > 0 &&
    /[a-zà-ỹ]{2,}\s+[a-zà-ỹ]{2,}/iu.test(textBeforeFirstDate);

  const hasQuestionMark = /[?？]/u.test(raw);
  const hasQuestionWord = ASK.test(normalized);
  const hasRequest = REQUEST.test(normalized);
  const hasFutureIntent = FUTURE.test(normalized);
  const hasPoliteEnding = POLITE_ENDING.test(folded);

  if (hasQuestionMark) {
    score += 0.45;
    reasons.push("question-mark");
  }

  if (hasQuestionWord) {
    score += 0.35;
    reasons.push("question-word");
  }

  if (hasRequest) {
    score += 0.45;
    reasons.push("request-reading");
  }

  /*
   * Sửa logic cũ:
   * relationshipAlias vẫn phải được tính là topic,
   * kể cả khi detectTopics() chưa nhận diện được alias.
   */
  if (topics.length || relationshipAlias) {
    score += 0.30;

    reasons.push(
      relationshipAlias
        ? "topic:relationship_alias:tcam"
        : `topic:${topics[0]}`,
    );
  }

  if (hasFutureIntent) {
    score += 0.25;

    reasons.push(
      breakupOrReturnAlias
        ? "intent:future-alias"
        : "intent:future",
    );
  }

  if (dates.length) {
    score += 0.20;
    reasons.push("contains-birth-date");
  }

  if (personPattern) {
    score += 0.15;
    reasons.push("contains-person-pattern");
  }

  /*
   * Nhận diện đuôi lịch sự:
   * ạ -> a sau khi folded
   * à -> a
   * ah -> ah
   *
   * Không cộng điểm nếu chỉ có chữ "ạ".
   * Phải đi cùng từ nghi vấn, yêu cầu xem bài,
   * hoặc ý định như "quay lại".
   */
  if (
    hasPoliteEnding &&
    (hasQuestionWord || hasRequest || hasFutureIntent)
  ) {
    score += 0.10;
    reasons.push("polite-question-ending");
  }

  /*
   * Câu hỏi tarot ngầm thường không có dấu hỏi:
   * - tình duyên sắp tới
   * - công việc tháng tới
   * - tcam qlai hoh a
   */
  if (
    (topics.length || relationshipAlias) &&
    hasFutureIntent
  ) {
    score += 0.10;
    reasons.push("implicit-question:topic+future");
  }

  const onlySymbols =
    /^(?:[^\p{L}\p{N}]|\s)+$/u.test(raw);

  const onlyBirthDate =
    /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(normalized);

  if (
    NEGATIVE.test(normalized) ||
    onlySymbols ||
    onlyBirthDate
  ) {
    score = 0;
    reasons.push("negative:non-question");
  }

  score = Math.max(
    0,
    Math.min(1, Number(score.toFixed(2))),
  );

  return {
    question: score >= QUESTION_THRESHOLD,
    score,
    reasons,
  };
}

export function isQuestion(text, options) {
  return classifyQuestion(text, options).question;
}
