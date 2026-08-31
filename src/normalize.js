const FILLER_PHRASES = [
  "chị ơi", "anh ơi", "shop ơi", "giúp em với", "xem giúp em",
  "cho em hỏi", "xem giúp mình", "giúp mình với"
];

export function normalizeText(value) {
  let text = String(value ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
  for (const phrase of FILLER_PHRASES) {
    const normalizedPhrase = phrase.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
    text = text.replaceAll(normalizedPhrase, " ");
  }
  return text
    .replace(/\b(a|ah|ạ|nha|nhe|nhé|voi|với)\b/g, " ")
    .replace(/[^a-z0-9\s/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractDates(value) {
  const text = normalizeText(value);
  return [...text.matchAll(/\b(?:0?[1-9]|[12]\d|3[01])[\/.\-](?:0?[1-9]|1[0-2])[\/.\-](?:\d{2}|\d{4})\b/g)]
    .map(match => match[0].replace(/[.\-]/g, "/"));
}

const TOPICS = {
  "tinh-cam": ["tinh cam", "nguoi cu", "yeu", "moi quan he", "quay lai", "doc than"],
  "cong-viec": ["cong viec", "su nghiep", "viec lam"],
  "tai-chinh": ["tai chinh", "tien bac", "thu nhap", "kinh doanh"],
  "gia-dinh": ["gia dinh", "ba me", "vo chong", "con cai"],
  "suc-khoe": ["suc khoe", "benh", "the trang"]
};

export function detectTopics(value) {
  const text = normalizeText(value);
  return Object.entries(TOPICS)
    .filter(([, terms]) => terms.some(term => text.includes(term)))
    .map(([topic]) => topic);
}

export function extractIdentityHint(value) {
  const text = normalizeText(value);
  const firstDateIndex = text.search(/\b(?:0?[1-9]|[12]\d|3[01])[\/.-](?:0?[1-9]|1[0-2])[\/.-](?:\d{2}|\d{4})\b/);
  if (firstDateIndex < 0) return "";
  return text.slice(0, firstDateIndex)
    .replace(/\b(ten|em|minh|la|va|voi)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
