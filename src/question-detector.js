import {
  detectTopics,
  extractDates,
  normalizeText,
} from "./normalize.js";

export const QUESTION_THRESHOLD = 0.60;
export const QUESTION_REVIEW_THRESHOLD = 0.35;
export const MIN_RELATIONSHIP_AGE = 18;

const ASK =
  /\b(khong|ko|k|hong|hoh|hok|hem|khum|kg|kh|chua|sao|gi|nao|bao gio|bao nhieu|bao lau|khi nao|co khong|duoc khong|con khong|the nao|nhu the nao|ra sao)\b/;

const REQUEST =
  /\b(xem giup|xem dum|xem cho em|xem em voi|xem minh voi|coi giup|coi dum|coi cho|coi em voi|trai bai|trai giup|xin xem|cho em hoi|chi xem|anh xem)\b/;

const FUTURE =
  /\b(sap toi|thang toi|nam nay|tuong lai|quay lai|con duyen|tiep tuc|di tiep|tai hop)\b/;

const IMPLICIT_READING =
  /\b(ve van de|van de|muon xem ve|can xem ve|hoi ve|em hoi ve|minh hoi ve|xem ve|coi ve|cho em ve|cho minh ve)\b/;

const GIFT_CLAIM =
  /(?:\b(vua gui|da gui|gui roi|moi gui|tang roi)\b.{0,40}\b(co 4 la|co bon la|4 la|gift|qua)\b)|(?:\b(co 4 la|co bon la|4 la|gift|qua)\b.{0,40}\b(vua gui|da gui|gui roi|moi gui|tang roi)\b)/u;

const POLITE_ENDING =
  /\b(a|ah|nha|nhe)\b(?:\s|[^\p{L}\p{N}])*$/u;

const NEGATIVE =
  /^(hi|hello|chao chi|em chao chi|xinh qua|hay qua|dung roi|cam on chi|cam on chi a)$/;

const RELATIONSHIP_TOPIC =
  /\b(tinh cam|tinh duyen|tinh yeu|yeu duong|nguoi yeu|nguoi yeu cu|nguoi cu|nguoi ay|nguoi do|ban ay|anh ay|co ay|doi phuong|ban trai|ban gai|crush|hon nhan|vo chong|chong|vo|moi quan he|dang tim hieu|map mo|don phuong|co tinh cam|co thich|co nguoi moi|co nguoi khac|con thuong|con nho|quay lai|chia tay|tai hop|con duyen|co duyen|di tiep|lien lac|nhan tin|chu dong|tien toi|ket noi lai)\b/;

const RELATIONSHIP_INTENT =
  /\b(nghi gi ve|co tinh cam|co thich|co nguoi moi|co nguoi khac|con thuong|con nho|co quay lai|co tai hop|con duyen|co lien lac|co nhan tin|co chu dong|co tien toi|ket noi lai|di tiep duoc khong)\b/;

const CONTEXTUAL_TOPIC =
  /\b(cong viec|tai chinh|hoc tap|su nghiep|gia dinh|suc khoe|dinh huong|nang luong|ket qua|thi cu|phong van)\b/;

function expandTikTokAliases(text) {
  let value = String(text ?? "");

  const aliases = [
    [/\bqlai\b/g, "quay lai"],
    [/\bq\s*lai\b/g, "quay lai"],
    [/\bql\b/g, "quay lai"],

    [/\bctay\b/g, "chia tay"],
    [/\bchiatay\b/g, "chia tay"],
    [/\bc\s*tay\b/g, "chia tay"],
    [/\bct\b/g, "chia tay"],

    [/\bhoh\b/g, "khong"],
    [/\bhong\b/g, "khong"],
    [/\bhok\b/g, "khong"],
    [/\bhem\b/g, "khong"],
    [/\bkhum\b/g, "khong"],
    [/\bkg\b/g, "khong"],
    [/\bkh\b/g, "khong"],

    [/\bdk\b/g, "duoc khong"],
    [/\bdc\b/g, "duoc"],

    [/\bntn\b/g, "nhu the nao"],
    [/\bbh\b/g, "bao gio"],
    [/\bbjo\b/g, "bao gio"],
    [/\bbg\b/g, "bao gio"],
    [/\bbn\b/g, "bao nhieu"],

    [/\bnyc\b/g, "nguoi yeu cu"],
    [/\bny\b/g, "nguoi yeu"],
    [/\bmqh\b/g, "moi quan he"],
    [/\bcduyen\b/g, "con duyen"],
    [/\bllac\b/g, "lien lac"],
    [/\bntin\b/g, "nhan tin"],

    [/\btcam\b/g, "tinh cam"],
    [/\bt\s*\/\s*cam\b/g, "tinh cam"],
    [/\bt\s+cam\b/g, "tinh cam"],
    [/\btduyen\b/g, "tinh duyen"],

    [/\bcviec\b/g, "cong viec"],
    [/\bcv(?:iec)?\b/g, "cong viec"],
    [/\btchinh\b/g, "tai chinh"],
    [/\bkqua\b/g, "ket qua"],

    [/\bhc\s*tap\b/g, "hoc tap"],
    [/\bhctap\b/g, "hoc tap"],
    [/\bhoctap\b/g, "hoc tap"],
    [/\bhoc\s*tapp+\b/g, "hoc tap"],

    [/\bsap\s*toi+\b/g, "sap toi"],
    [/\bsaptoi+\b/g, "sap toi"],

    [/\b4las\b/g, "co 4 la"],
    [/\b4la\b/g, "co 4 la"],
    [/\bco\s*4\s*las?\b/g, "co 4 la"],
    [/\bco\s*bon\s*la\b/g, "co 4 la"],

    [/\bgui\s*r\b/g, "gui roi"],
    [/\btang\s*r\b/g, "tang roi"],
  ];

  for (const [pattern, replacement] of aliases) {
    value = value.replace(
      pattern,
      replacement,
    );
  }

  return value
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDateSeparators(text) {
  return String(text ?? "").replace(
    /(\d{1,2})\s*[@*_]\s*(\d{1,2})\s*[@*_]\s*(\d{2,4})/g,
    "$1/$2/$3",
  );
}

function normalizeSpacedDates(text) {
  return String(text ?? "").replace(
    /(^|[^\d])(\d{1,2})\s+(\d{1,2})\s+(\d{2,4})(?=$|[^\d])/g,
    (
      match,
      prefix,
      dayText,
      monthText,
      yearText,
    ) => {
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

function normalizeCompactDates(
  text,
  now,
) {
  const currentYear =
    now.getUTCFullYear();

  return String(text ?? "").replace(
    /(^|[^\d])(\d{6}|\d{8})(?=$|[^\d])/g,
    (
      match,
      prefix,
      compact,
    ) => {
      const dayText =
        compact.slice(0, 2);

      const monthText =
        compact.slice(2, 4);

      const yearText =
        compact.slice(4);

      const day = Number(dayText);
      const month = Number(monthText);

      const year = resolveBirthYear(
        yearText,
        currentYear,
      );

      if (
        year === null ||
        year > currentYear ||
        year < currentYear - 120 ||
        !isValidCalendarDate(
          year,
          month,
          day,
        )
      ) {
        return match;
      }

      return `${prefix}${dayText}/${monthText}/${yearText}`;
    },
  );
}

function resolveBirthYear(
  yearText,
  currentYear,
) {
  const value = String(yearText ?? "")
    .toLowerCase()
    .trim();

  let match = value.match(
    /^2k(\d{1,2})$/,
  );

  if (match) {
    return 2000 + Number(match[1]);
  }

  match = value.match(
    /^k(\d{1,2})$/,
  );

  if (match) {
    return 2000 + Number(match[1]);
  }

  if (/^2\d{2}$/.test(value)) {
    return 2000 + Number(
      value.slice(1),
    );
  }

  if (/^(19|20)\d{2}$/.test(value)) {
    return Number(value);
  }

  if (/^\d{2}$/.test(value)) {
    const shortYear = Number(value);
    const currentShortYear =
      currentYear % 100;

    return shortYear <= currentShortYear
      ? 2000 + shortYear
      : 1900 + shortYear;
  }

  return null;
}

function isValidCalendarDate(
  year,
  month,
  day,
) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const value = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
    ),
  );

  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() + 1 === month &&
    value.getUTCDate() === day
  );
}

function extractBirthCandidates(
  text,
  now,
) {
  const value = String(text ?? "");
  const currentYear =
    now.getUTCFullYear();

  const candidates = [];
  const occupiedRanges = [];

  const fullDatePattern =
    /(^|[^\d])(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})(?=$|[^\d])/g;

  for (
    const match of value.matchAll(
      fullDatePattern,
    )
  ) {
    const day = Number(match[2]);
    const month = Number(match[3]);

    const originalYear = match[4];

    const year = resolveBirthYear(
      originalYear,
      currentYear,
    );

    const leadingLength =
      match[1].length;

    const start =
      match.index + leadingLength;

    const end =
      match.index + match[0].length;

    occupiedRanges.push([
      start,
      end,
    ]);

    if (
      year !== null &&
      day >= 1 &&
      day <= 31 &&
      month >= 1 &&
      month <= 12
    ) {
      const ambiguousYear =
        /^\d{3}$/.test(originalYear);

      candidates.push({
        year,
        month,
        day,
        exactDate: true,
        ambiguousYear,
        validCalendarDate:
          !ambiguousYear &&
          isValidCalendarDate(
            year,
            month,
            day,
          ),
        originalYear,
      });
    }
  }

  const yearPattern =
    /\b(2k\d{1,2}|k\d{1,2}|(?:19|20)\d{2}|2\d{2})\b/g;

  for (
    const match of value.matchAll(
      yearPattern,
    )
  ) {
    const start = match.index;
    const end =
      start + match[0].length;

    const belongsToFullDate =
      occupiedRanges.some(
        ([rangeStart, rangeEnd]) =>
          start >= rangeStart &&
          end <= rangeEnd,
      );

    if (belongsToFullDate) {
      continue;
    }

    const year = resolveBirthYear(
      match[1],
      currentYear,
    );

    if (year !== null) {
      candidates.push({
        year,
        month: null,
        day: null,
        exactDate: false,
        ambiguousYear: false,
        validCalendarDate: true,
        originalYear: match[1],
      });
    }
  }

  return candidates;
}

function calculateAge(
  candidate,
  now,
) {
  const currentYear =
    now.getUTCFullYear();

  const ageByYear =
    currentYear - candidate.year;

  if (!candidate.exactDate) {
    return ageByYear;
  }

  const currentMonth =
    now.getUTCMonth() + 1;

  const currentDay =
    now.getUTCDate();

  const birthdayPassed =
    currentMonth > candidate.month ||
    (
      currentMonth ===
        candidate.month &&
      currentDay >= candidate.day
    );

  return ageByYear -
    (birthdayPassed ? 0 : 1);
}

function findUnderageRelationshipBirth(
  text,
  now,
) {
  const candidates =
    extractBirthCandidates(
      text,
      now,
    );

  return (
    candidates.find((candidate) => {
      if (
        candidate.ambiguousYear ||
        !candidate.validCalendarDate
      ) {
        return false;
      }

      const age = calculateAge(
        candidate,
        now,
      );

      if (candidate.exactDate) {
        return age <
          MIN_RELATIONSHIP_AGE;
      }

      return age <=
        MIN_RELATIONSHIP_AGE;
    }) ?? null
  );
}

export function classifyQuestion(
  text,
  {
    forced = false,
    system = false,
    now = new Date(),
  } = {},
) {
  const raw =
    String(text ?? "").trim();

  if (!raw || system) {
    return {
      question: false,
      classification: "not_question",
      eligible: false,
      needsReview: false,
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
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .replace(/đ/g, "d");

  const expanded =
    expandTikTokAliases(folded);

  const dateSeparated =
    normalizeDateSeparators(
      expanded,
    );

  const spacedDateNormalized =
    normalizeSpacedDates(
      dateSeparated,
    );

  const dateNormalized =
    normalizeCompactDates(
      spacedDateNormalized,
      now,
    );

  const hasCompactBirthDate =
    dateNormalized !==
      spacedDateNormalized;

  const normalized =
    normalizeText(dateNormalized);

  const birthCandidates =
    extractBirthCandidates(
      dateNormalized,
      now,
    );

  const ambiguousBirthCandidate =
    birthCandidates.find(
      (candidate) =>
        candidate.ambiguousYear ||
        !candidate.validCalendarDate,
    ) ?? null;

  const hasRelationshipTopic =
    RELATIONSHIP_TOPIC.test(
      normalized,
    );

  const underageRelationshipBirth =
    hasRelationshipTopic
      ? findUnderageRelationshipBirth(
          dateNormalized,
          now,
        )
      : null;

  if (underageRelationshipBirth) {
    return {
      question: false,
      classification: "blocked",
      eligible: false,
      needsReview: false,
      blockReason:
        "underage-relationship",
      score: 0,
      reasons: [
        "blocked:underage-relationship",
        `birth-year:${underageRelationshipBirth.year}`,
        ...(hasCompactBirthDate
          ? [
              "birth-format:compact-ddmmyy",
            ]
          : []),
      ],
    };
  }

  if (forced) {
    return {
      question: true,
      classification:
        ambiguousBirthCandidate
          ? "needs_review"
          : "question",
      eligible: true,
      needsReview:
        Boolean(
          ambiguousBirthCandidate,
        ),
      score: 1,
      reasons: [
        "tiktok-question-event",
        ...(hasCompactBirthDate
          ? [
              "birth-format:compact-ddmmyy",
            ]
          : []),
        ...(ambiguousBirthCandidate
          ? [
              ambiguousBirthCandidate
                .ambiguousYear
                ? "review:ambiguous-birth-year"
                : "review:invalid-calendar-date",
            ]
          : []),
      ],
    };
  }

  const reasons = [];
  let score = 0;

  const topics =
    detectTopics(normalized);

  const dates =
    extractDates(normalized);

  const relationshipAlias =
    /\b(tcam|t\s*\/\s*cam|t\s+cam|tduyen)\b/u.test(
      folded,
    );

  const breakupOrReturnAlias =
    /\b(qlai|q\s*lai|ql|ct|ctay|chiatay|c\s*tay)\b/u.test(
      folded,
    );

  const educationAlias =
    /\b(hc\s*tap|hctap|hoctap|hoc\s*tapp+)\b/u.test(
      folded,
    );

  const hasTopic =
    topics.length > 0 ||
    relationshipAlias ||
    educationAlias ||
    RELATIONSHIP_TOPIC.test(
      normalized,
    ) ||
    CONTEXTUAL_TOPIC.test(
      normalized,
    );

  const hasRelationshipIntent =
    RELATIONSHIP_INTENT.test(
      normalized,
    );

  const hasQuestionMark =
    /[?？]/u.test(raw);

  const hasQuestionWord =
    ASK.test(normalized);

  const hasRequest =
    REQUEST.test(normalized);

  const hasFutureIntent =
    FUTURE.test(normalized);

  const hasImplicitReading =
    IMPLICIT_READING.test(
      normalized,
    );

  const hasGiftClaim =
    GIFT_CLAIM.test(normalized);

  const hasPoliteEnding =
    POLITE_ENDING.test(folded);

  const firstDigitIndex =
    raw.search(/\d/);

  const textBeforeFirstDate =
    firstDigitIndex >= 0
      ? raw.slice(
          0,
          firstDigitIndex,
        )
      : raw;

  const personPattern =
    (
      dates.length > 0 ||
      birthCandidates.length > 0
    ) &&
    /[a-zà-ỹ]{2,}\s+[a-zà-ỹ]{2,}/iu.test(
      textBeforeFirstDate,
    );

  if (hasQuestionMark) {
    score += 0.45;
    reasons.push(
      "question-mark",
    );
  }

  if (hasQuestionWord) {
    score += 0.35;
    reasons.push(
      "question-word",
    );
  }

  if (hasRequest) {
    score += 0.45;
    reasons.push(
      "request-reading",
    );
  }

  if (hasTopic) {
    score += 0.30;

    if (relationshipAlias) {
      reasons.push(
        "topic:relationship_alias:tcam",
      );
    } else if (educationAlias) {
      reasons.push(
        "topic:education_alias:hoc-tap",
      );
    } else if (topics.length > 0) {
      reasons.push(
        `topic:${topics[0]}`,
      );
    } else if (
      hasRelationshipTopic
    ) {
      reasons.push(
        "topic:relationship-context",
      );
    } else {
      reasons.push(
        "topic:contextual",
      );
    }
  }

  if (hasFutureIntent) {
    score += 0.25;

    reasons.push(
      breakupOrReturnAlias
        ? "intent:future-alias"
        : "intent:future",
    );
  }

  if (
    dates.length ||
    birthCandidates.length
  ) {
    score += 0.20;
    reasons.push(
      "contains-birth-date",
    );

    if (hasCompactBirthDate) {
      reasons.push(
        "birth-format:compact-ddmmyy",
      );
    }
  }

  if (personPattern) {
    score += 0.15;
    reasons.push(
      "contains-person-pattern",
    );
  }

  if (
    hasTopic &&
    hasImplicitReading
  ) {
    score += 0.30;
    reasons.push(
      "implicit-question:reading-topic",
    );
  }

  if (hasGiftClaim) {
    reasons.push(
      "gift-claim-in-comment",
    );

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

  if (
    hasPoliteEnding &&
    (
      hasQuestionWord ||
      hasRequest ||
      hasFutureIntent ||
      hasImplicitReading ||
      (
        hasGiftClaim &&
        hasTopic
      )
    )
  ) {
    score += 0.10;

    reasons.push(
      "polite-question-ending",
    );
  }

  if (
    hasTopic &&
    hasFutureIntent
  ) {
    score += 0.10;

    reasons.push(
      "implicit-question:topic+future",
    );
  }

  if (hasRelationshipIntent) {
    score += 0.30;
    reasons.push(
      "intent:relationship",
    );
  }

  if (ambiguousBirthCandidate) {
    reasons.push(
      ambiguousBirthCandidate
        .ambiguousYear
        ? "review:ambiguous-birth-year"
        : "review:invalid-calendar-date",
    );
  }

  const onlySymbols =
    /^(?:[^\p{L}\p{N}]|\s)+$/u.test(
      raw,
    );

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

    reasons.push(
      "negative:non-question",
    );
  }

  score = Math.max(
    0,
    Math.min(
      1,
      Number(score.toFixed(2)),
    ),
  );

  const question =
    score >= QUESTION_THRESHOLD;

  const needsReview =
    Boolean(
      ambiguousBirthCandidate,
    ) ||
    (
      !question &&
      score >=
        QUESTION_REVIEW_THRESHOLD
    );

  if (
    !question &&
    needsReview &&
    !ambiguousBirthCandidate
  ) {
    reasons.push(
      "review:near-question-threshold",
    );
  }

  return {
    question,
    classification: question
      ? (
          needsReview
            ? "needs_review"
            : "question"
        )
      : (
          needsReview
            ? "needs_review"
            : "not_question"
        ),
    eligible: question,
    needsReview,
    score,
    reasons,
  };
}

export function isQuestion(
  text,
  options,
) {
  return classifyQuestion(
    text,
    options,
  ).question;
}