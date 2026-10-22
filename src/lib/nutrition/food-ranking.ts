export type FoodRankingCandidate = {
  id: string;
  name: string;
  brand: string | null;
  source: string;
  isFromHistory?: boolean;
  usageCount?: number;
  timeOfDayUsageCount?: number;
  lastUsedAt?: string | null;
};

const LOCAL_SEARCH_ALIASES: Record<string, string[]> = {
  ckt: ['char kway teow', 'char koay teow'],
  'char kway teow': ['ckt', 'char koay teow'],
  'char koay teow': ['ckt', 'char kway teow'],
  'cai png': ['cai fan', 'economy rice', 'mixed rice'],
  'cai fan': ['cai png', 'economy rice', 'mixed rice'],
  'economy rice': ['cai png', 'cai fan', 'mixed rice'],
};

export function normalizeFoodSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function rankFoodCandidates<T extends FoodRankingCandidate>(
  candidates: T[],
  query: string,
  limit = 8,
  now = new Date(),
): T[] {
  const normalizedQuery = normalizeFoodSearch(query);
  return candidates
    .map((candidate) => ({ candidate, score: foodCandidateScore(candidate, normalizedQuery, now) }))
    .filter((ranked) => !normalizedQuery || ranked.score > 0)
    .sort((a, b) => b.score - a.score
      || (b.candidate.lastUsedAt ?? '').localeCompare(a.candidate.lastUsedAt ?? '')
      || a.candidate.name.localeCompare(b.candidate.name))
    .slice(0, Math.max(0, limit))
    .map(({ candidate }) => candidate);
}

function foodCandidateScore(candidate: FoodRankingCandidate, query: string, now: Date): number {
  const historyBoost = candidate.isFromHistory ? 180 : candidate.source === 'custom' ? 100 : 0;
  const frequencyBoost = Math.min(candidate.usageCount ?? 0, 30) * 8;
  const timeBoost = Math.min(candidate.timeOfDayUsageCount ?? 0, 20) * 18;
  const recencyBoost = recencyScore(candidate.lastUsedAt, now);
  if (!query) return historyBoost + frequencyBoost + timeBoost + recencyBoost;

  const name = normalizeFoodSearch(candidate.name);
  const brand = normalizeFoodSearch(candidate.brand ?? '');
  const haystacks = new Set([name, brand, `${name} ${brand}`.trim()]);
  const queryVariants = new Set([query, ...(LOCAL_SEARCH_ALIASES[query] ?? [])].map(normalizeFoodSearch));
  let match = 0;
  for (const variant of queryVariants) {
    for (const haystack of haystacks) {
      if (!haystack) continue;
      if (haystack === variant) match = Math.max(match, 1_000);
      else if (haystack.startsWith(variant)) match = Math.max(match, 820);
      else if (haystack.includes(variant)) match = Math.max(match, 660);
      else if (wordsMatch(haystack, variant)) match = Math.max(match, 560);
      else if (acronym(haystack) === variant) match = Math.max(match, 720);
      else if (isCloseSpelling(haystack, variant)) match = Math.max(match, 430);
    }
  }
  return match ? match + historyBoost + frequencyBoost + timeBoost + recencyBoost : 0;
}

function wordsMatch(value: string, query: string): boolean {
  const words = value.split(' ');
  return query.split(' ').every((term) => words.some((word) => word.startsWith(term)));
}

function acronym(value: string): string {
  return value.split(' ').filter(Boolean).map((word) => word[0]).join('');
}

function isCloseSpelling(value: string, query: string): boolean {
  const values = [value, ...value.split(' ')];
  const queries = [query, ...query.split(' ')];
  return queries.every((term) => values.some((candidate) => {
    if (Math.abs(candidate.length - term.length) > 2) return false;
    const allowance = term.length >= 7 ? 2 : term.length >= 4 ? 1 : 0;
    return allowance > 0 && editDistanceWithin(candidate, term, allowance);
  }));
}

function editDistanceWithin(left: string, right: string, maximum: number): boolean {
  if (Math.abs(left.length - right.length) > maximum) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0]!;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      const value = Math.min(previous[rightIndex]! + 1, current[rightIndex - 1]! + 1, substitution);
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return false;
    previous = current;
  }
  return previous[right.length]! <= maximum;
}

function recencyScore(value: string | null | undefined, now: Date): number {
  if (!value) return 0;
  const usedAt = new Date(value).getTime();
  if (!Number.isFinite(usedAt)) return 0;
  const ageDays = Math.max(0, (now.getTime() - usedAt) / 86_400_000);
  return Math.max(0, 90 - Math.floor(ageDays));
}
