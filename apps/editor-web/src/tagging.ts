import { Token } from "@schema/index";

function normalizeWord(value: string): string {
  return value.trim().toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

function isCapitalizedWord(value: string): boolean {
  return /^[A-Z][a-z]/.test(value.trim());
}

export function inferPartOfSpeech(token: Token): string {
  const raw = token.surfaceText.trim();
  const normalized = normalizeWord(token.normalizedText || token.surfaceText);

  if (!normalized) {
    return token.partOfSpeech || "";
  }

  const pronouns = new Set(["i", "me", "my", "mine", "we", "us", "our", "ours", "you", "your", "yours", "he", "him", "his", "she", "her", "hers", "it", "its", "they", "them", "their", "theirs"]);
  const articles = new Set(["a", "an", "the"]);
  const conjunctions = new Set(["and", "but", "or", "nor", "for", "yet", "so", "that"]);
  const prepositions = new Set(["in", "on", "at", "by", "to", "from", "with", "into", "through", "over", "under", "after", "before", "of", "for", "unto"]);
  const auxiliaries = new Set(["am", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has", "had", "shall", "will", "should", "would", "may", "might", "must", "can", "could"]);
  const adverbs = new Set(["not", "very", "so", "thus", "there", "here"]);

  if (pronouns.has(normalized)) return "pronoun";
  if (articles.has(normalized)) return "article";
  if (conjunctions.has(normalized)) return "conjunction";
  if (prepositions.has(normalized)) return "preposition";
  if (auxiliaries.has(normalized)) return "verb";
  if (adverbs.has(normalized) || normalized.endsWith("ly")) return "adverb";
  if (normalized.endsWith("ing") || normalized.endsWith("ed")) return "verb";
  if (normalized.endsWith("ous") || normalized.endsWith("ful") || normalized.endsWith("ive") || normalized.endsWith("al")) return "adjective";
  if (token.isProperNoun || isCapitalizedWord(raw)) return "noun";
  return "noun";
}

export function inferWordColorCategory(token: Token, tokens: Token[], index: number): Token["wordColorCategory"] {
  const raw = token.surfaceText.trim();
  const normalized = normalizeWord(token.normalizedText || token.surfaceText);
  const previous = normalizeWord(tokens[index - 1]?.normalizedText ?? tokens[index - 1]?.surfaceText ?? "");
  const next = normalizeWord(tokens[index + 1]?.normalizedText ?? tokens[index + 1]?.surfaceText ?? "");
  const nextTwo = normalizeWord(tokens[index + 2]?.normalizedText ?? tokens[index + 2]?.surfaceText ?? "");

  if (!normalized) {
    return "";
  }

  const godWords = new Set(["god", "lord", "jesus", "christ", "messiah", "yahweh", "jehovah", "holy", "spirit", "father", "son"]);
  const goodAngelWords = new Set(["angel", "angels", "archangel", "cherub", "cherubim", "seraph", "seraphim", "gabriel", "michael"]);
  const badAngelWords = new Set(["satan", "devil", "demons", "demon", "evil", "unclean"]);
  const personNameWords = new Set([
    "paul", "john", "luke", "moses", "abraham", "isaac", "jacob", "joseph", "david", "solomon", "peter", "james", "mary",
    "martha", "lazarus", "samuel", "isaiah", "jeremiah", "ezekiel", "daniel", "noah", "adam", "eve", "aaron", "joshua",
    "timothy", "titus", "barnabas", "silas", "pilate", "herod", "pharaoh", "nicodemus"
  ]);
  const groupNameWords = new Set([
    "jew", "jews", "gentile", "gentiles", "roman", "romans", "canaanite", "canaanites", "israelite", "israelites", "pharisee",
    "pharisees", "sadducee", "sadducees", "greek", "greeks", "hebrew", "hebrews", "egyptian", "egyptians", "babylonian", "babylonians"
  ]);
  const peopleWords = new Set([
    "man", "men", "woman", "women", "child", "children", "person", "people", "king", "queen", "prophet", "disciple", "servant",
    "brother", "brothers", "sister", "sisters", "mother", "father", "son", "sons", "daughter", "daughters", "teacher", "teachers",
    "ruler", "rulers", "master", "masters", "servants", "he", "him", "his", "she", "her", "hers", "they", "them", "their", "theirs",
    "we", "us", "our", "ours", "who", "whom", "thou", "thee", "thy", "ye"
  ]);
  const placeNameWords = new Set([
    "jerusalem", "canaan", "egypt", "rome", "israel", "bethlehem", "nazareth", "galilee", "jordan", "babylon", "samaria", "judea",
    "damascus", "corinth", "ephesus", "caesarea", "jericho", "sinai"
  ]);
  const placeWords = new Set(["heaven", "earth", "world", "city", "land", "sea", "river", "mount", "mountain", "wilderness", "temple", "garden", "field", "house", "road", "kingdom"]);
  const timeWords = new Set(["day", "days", "night", "nights", "year", "years", "month", "months", "hour", "hours", "time", "season", "today", "tomorrow", "yesterday", "sabbath", "beginning"]);
  const numberWords = new Set([
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "first", "second", "third",
    "many", "few", "double", "hundred", "thousand"
  ]);

  if (godWords.has(normalized) || (normalized === "spirit" && previous === "holy")) return "god";
  if (badAngelWords.has(normalized) || ((normalized === "angel" || normalized === "angels") && (previous === "evil" || previous === "unclean" || next === "bottomless"))) return "bad_angels";
  if (goodAngelWords.has(normalized) || ((normalized === "angel" || normalized === "angels") && (next === "of" && (nextTwo === "the" || nextTwo === "god" || nextTwo === "lord")))) return "good_angels";
  if (personNameWords.has(normalized)) return "person_name";
  if (groupNameWords.has(normalized) || normalized.endsWith("ites") || normalized.endsWith("ians")) return "group_name";
  if (placeNameWords.has(normalized)) return "place_name";
  if (placeWords.has(normalized)) return "place";
  if (timeWords.has(normalized)) return "time";
  if (numberWords.has(normalized) || /^\d+$/.test(normalized)) return "number";
  if (peopleWords.has(normalized)) return "people";

  if (isCapitalizedWord(raw)) {
    if (["in", "into", "from", "to", "toward", "unto"].includes(previous)) {
      return "place_name";
    }
    if (["king", "queen", "prophet", "apostle", "disciple"].includes(previous)) {
      return "person_name";
    }
    return "person_name";
  }

  return "things";
}

export function inferProperNoun(token: Token, tokens: Token[], index: number): boolean {
  const category = inferWordColorCategory(token, tokens, index);
  if (["god", "good_angels", "bad_angels", "person_name", "group_name", "place_name"].includes(category)) {
    return true;
  }
  return isCapitalizedWord(token.surfaceText);
}

export function autoTagTokens(tokens: Token[]): Token[] {
  const base = tokens.map((token) => ({
    ...token,
    normalizedText: token.normalizedText || normalizeWord(token.surfaceText)
  }));

  return base.map((token, index, entries) => {
    const wordColorCategory = inferWordColorCategory(token, entries, index);
    const isProperNoun = inferProperNoun({ ...token, wordColorCategory }, entries, index);
    return {
      ...token,
      wordColorCategory,
      isProperNoun,
      partOfSpeech: inferPartOfSpeech({ ...token, wordColorCategory, isProperNoun })
    };
  });
}
