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

/**
 * Những cấu trúc người xem dùng để gửi chủ đề cần Reader xem,
 * dù không viết thành một câu hỏi đầy đủ.
 *
 * Ví dụ:
 * - về vấn đề học tập
 * - muốn xem về công việc
 * - em hỏi về tình duyên
 */
const IMPLICIT_READING =
  /\b(ve van de|van de|muon xem ve|can xem ve|hoi ve|em hoi ve|minh hoi ve|xem ve|coi ve|cho em ve|cho minh ve)\b/;

/**
 * Nhận diện người xem đang nói rằng họ vừa gửi quà.
 *
 * Đây chỉ là tín hiệu hỗ trợ phân loại comment thành câu hỏi.
 * Không dùng kết quả này để xác nhận gift thật.
 */
const GIFT_CLAIM =
  /(?:\b(vua gui|da gui|gui roi|gui r|moi gui|tang roi|tang r)\b.{0,40}\b(co 4 la|co bon la|4 la|gift|qua)\b)|(?:\b(co 4 la|co bon la|4 la|gift|qua)\b.{0,40}\b(vua gui|da gui|gui roi|gui r|moi gui|tang roi|tang r)\b)/u;

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
 * 4las       -> co 4 la
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

    // Gift: cỏ 4 lá
    [/\b4las\b/g, "co 4 la"],
    [/\b4la\b/g, "co 4 la"],
    [/\bco\s*4\s*las?\b/g, "co 4 la"],
    [/\bco\s*bon\s*la\b/g, "co 4 la"],

    // Cách viết trạng thái đã gửi
    [/\bgui\s*r\b/g, "gui roi"],
    [/\btang\s*r\b/g, "tang roi"],
  ];

  for (const [pattern, replacement] of aliases) {
    value = value.replace(pattern, replacement);
  }

  return value.replace(/\s+/g, " ").trim();
}

/**
 * Chuẩn hóa ngày sinh viết cách nhau bằng khoảng trắng.
 *
 * Chỉ chuyển đổi khi chuỗi có dạng ngày/tháng/năm hợp lệ cơ bản:
 * - 6 5 2012  -> 6/5/2012
 * - 30 9 2001 -> 30/9/2001
 *
 * Tránh chuyển đổi tùy tiện mọi cụm ba con số.
 */
function normalizeSpacedDates(text) {
  return String(text ?? "").replace(
    /(^|[^\d])(\d{1,2})\s+(\d{1,2})\s+(\d{2,4})(?=$|[^\d])/g,
    (match, prefix, dayText, monthText, yearText) => {
      const day = Number(dayText);
      const month = Number(monthText);

      if (
        day < 1 ||
        day > 31 ||
        month < 1 ||
        month > 12
      ) {
        return match;
      }

      return `${prefix}${dayText}/${monthText}/${yearText}`;
    },
  );
}

/**
 * Chuẩn hóa các dấu phân cách ngày sinh thường gặp.
 *
 * Ví dụ:
 * - 6@5@91 -> 6/5/91
 * - 6*5*91 -> 6/5/91
 * - 6_5_91 -> 6/5/91
 */
function normalizeDateSeparators(text) {
  return String(text ?? "").replace(
    /(\d{1,2})\s*[@*_]\s*(\d{1,2})\s*[@*_]\s*(\d{2,4})/g,
    "$1/$2/$3",
  );
}

export function classifyQuestion(
  text,
  { forced = false, system = false } = {},
) {
  const raw = String(text ?? "").trim();

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

  const folded = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

  /*
   * Thứ tự xử lý:
   * 1. Mở rộng từ viết tắt.
   * 2. Chuẩn hóa dấu phân cách ngày.
   * 3. Chuẩn hóa ngày dùng khoảng trắng.
   * 4. Chạy normalizeText của hệ thống hiện tại.
   */
  const expanded = expandTikTokAliases(folded);
  const dateSeparated = normalizeDateSeparators(expanded);
  const dateNormalized = normalizeSpacedDates(dateSeparated);
  const normalized = normalizeText(dateNormalized);

  const reasons = [];
  let score = 0;

  const topics = detectTopics(normalized);
  const dates = extractDates(normalized);

  const relationshipAlias =
    /\b(tcam|t\s*\/\s*cam|t\s+cam|tduyen)\b/u.test(folded);

  const breakupOrReturnAlias =
    /\b(qlai|q\s*lai|ql|ctay|chiatay|c\s*tay)\b/u.test(folded);

  const hasTopic =
    topics.length > 0 ||
    relationshipAlias;

  const hasQuestionMark =
    /[?？]/u.test(raw);

  const hasQuestionWord =
    ASK.test(normalized);

  const hasRequest =
    REQUEST.test(normalized);

  const hasFutureIntent =
    FUTURE.test(normalized);

  const hasImplicitReading =
    IMPLICIT_READING.test(normalized);

  const hasGiftClaim =
    GIFT_CLAIM.test(normalized);

  const hasPoliteEnding =
    POLITE_ENDING.test(folded);

  const firstDigitIndex =
    raw.search(/\d/);

  const textBeforeFirstDate =
    firstDigitIndex >= 0
      ? raw.slice(0, firstDigitIndex)
      : raw;

  const personPattern =
    dates.length > 0 &&
    /[a-zà-ỹ]{2,}\s+[a-zà-ỹ]{2,}/iu.test(
      textBeforeFirstDate,
    );

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
   * relationshipAlias vẫn được xem là topic,
   * kể cả khi detectTopics() chưa nhận diện alias.
   */
  if (hasTopic) {
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
   * Nhận diện câu hỏi/yêu cầu xem bài ngầm:
   * - về vấn đề học tập
   * - muốn xem về công việc
   * - hỏi về tình duyên
   *
   * Cần đồng thời có topic để hạn chế false positive.
   */
  if (hasTopic && hasImplicitReading) {
    score += 0.30;
    reasons.push("implicit-question:reading-topic");
  }

  /*
   * Ghi nhận câu nói có chứa nội dung khai báo gửi quà.
   *
   * Lưu ý:
   * Đây không phải xác nhận gift thật.
   * Gift thật phải được xác nhận bằng TikTok GIFT event.
   */
  if (hasGiftClaim) {
    reasons.push("gift-claim-in-comment");

    /*
     * Chỉ cộng điểm khi comment còn có ngữ cảnh xem bài:
     * - có chủ đề;
     * - có câu yêu cầu;
     * - có cấu trúc câu hỏi ngầm;
     * - hoặc có ý định tương lai.
     */
    if (
      hasTopic ||
      hasRequest ||
      hasImplicitReading ||
      hasFutureIntent
    ) {
      score += 0.15;
      reasons.push(
        "implicit-question:gift+reading-context",
      );
    }
  }

  /*
   * “ạ”, “a”, “ah” không tự động biến mọi comment thành câu hỏi.
   *
   * Chỉ cộng điểm nếu trước đó comment đã có:
   * - từ nghi vấn;
   * - yêu cầu xem;
   * - ý định tương lai;
   * - cấu trúc gửi chủ đề;
   * - hoặc gift claim đi cùng topic.
   */
  if (
    hasPoliteEnding &&
    (
      hasQuestionWord ||
      hasRequest ||
      hasFutureIntent ||
      hasImplicitReading ||
      (hasGiftClaim && hasTopic)
    )
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
    hasTopic &&
    hasFutureIntent
  ) {
    score += 0.10;
    reasons.push(
      "implicit-question:topic+future",
    );
  }

  const onlySymbols =
    /^(?:[^\p{L}\p{N}]|\s)+$/u.test(raw);

  const onlyBirthDate =
    /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(
      normalized,
    );

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
