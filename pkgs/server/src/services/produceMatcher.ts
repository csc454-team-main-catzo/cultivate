import ProduceItem, { type IProduceItem } from "../models/ProduceItem.js";

export interface VisionTag {
  name?: string | null;
  confidence?: number | null;
}

interface CachedProduceItems {
  expiresAt: number;
  items: IProduceItem[];
}

export interface MatchReason {
  desc: string;
  score: number;
  topicality?: number;
}

interface MatchResult {
  selected: {
    itemId: string;
    canonical: string;
    score: number;
    defaultUnit: string | null;
    commonUnits: string[];
    priceHints: Array<{
      unit: string;
      suggested: number;
      currency: string;
      referencePeriod: string;
      source: string;
    }>;
  } | null;
  bestScore: number;
  topCandidates: Array<{
    itemId: string;
    canonical: string;
    score: number;
  }>;
  threshold: number;
  itemId: string | null;
  itemName: string | null;
  confidence: number;
  reasons: MatchReason[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const TOP_LABELS = 10;
const produceItemsCache: CachedProduceItems = { expiresAt: 0, items: [] };

function normalizeLabel(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): Set<string> {
  return new Set(value.split(" ").filter(Boolean));
}

function getMatchWeight(normalizedLabel: string, normalizedTerm: string): number {
  if (!normalizedLabel || !normalizedTerm) return 0;
  if (normalizedLabel === normalizedTerm) return 1.0;
  if (
    normalizedLabel.includes(normalizedTerm) ||
    normalizedTerm.includes(normalizedLabel)
  ) {
    return 0.85;
  }

  const labelTokens = tokenize(normalizedLabel);
  const termTokens = tokenize(normalizedTerm);
  let overlap = 0;

  for (const token of labelTokens) {
    if (termTokens.has(token)) overlap += 1;
  }

  return overlap > 0 ? 0.6 : 0;
}

async function loadActiveProduceItemsCached(): Promise<IProduceItem[]> {
  const now = Date.now();
  if (produceItemsCache.expiresAt > now && produceItemsCache.items.length > 0) {
    return produceItemsCache.items;
  }

  const items = await ProduceItem.find({ active: true }).lean<IProduceItem[]>();
  produceItemsCache.items = items;
  produceItemsCache.expiresAt = now + CACHE_TTL_MS;
  return items;
}

export function toTitleCase(value: string): string {
  return value.replace(/\w\S*/g, (word) => {
    const first = word.charAt(0).toLocaleUpperCase();
    return `${first}${word.slice(1)}`;
  });
}

export async function matchProduceFromTags(
  tags: VisionTag[],
  threshold: number
): Promise<MatchResult> {
  const activeItems = await loadActiveProduceItemsCached();
  if (activeItems.length === 0) {
    return {
      selected: null,
      bestScore: 0,
      topCandidates: [],
      threshold,
      itemId: null,
      itemName: null,
      confidence: 0,
      reasons: [],
    };
  }

  const topTags = tags.slice(0, TOP_LABELS).filter((tag) => tag.name);
  let bestScore = 0;
  let bestItem: IProduceItem | null = null;
  const itemScores = new Map<string, { itemId: string; canonical: string; score: number }>();
  const reasons: MatchReason[] = [];

  for (const tag of topTags) {
    const rawTag = String(tag.name || "");
    const normalizedTag = normalizeLabel(rawTag);
    const tagScore = Number(tag.confidence || 0);

    for (const item of activeItems) {
      const candidateTerms = [item.canonical, ...(item.synonyms || [])];
      for (const term of candidateTerms) {
        const normalizedTerm = normalizeLabel(term);
        const weight = getMatchWeight(normalizedTag, normalizedTerm);
        if (weight === 0) continue;

        const score = tagScore * weight * (1 + item.priority * 0.05);
        const itemId = item._id.toString();
        const existingItemScore = itemScores.get(itemId);
        if (!existingItemScore || score > existingItemScore.score) {
          itemScores.set(itemId, {
            itemId,
            canonical: item.canonical,
            score,
          });
        }
        if (score > bestScore) {
          bestScore = score;
          bestItem = item;
        }
      }
    }

    reasons.push({
      desc: rawTag,
      score: tagScore,
    });
  }

  const topCandidates = Array.from(itemScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (!bestItem || bestScore < threshold) {
    return {
      selected: null,
      bestScore,
      topCandidates,
      threshold,
      itemId: null,
      itemName: null,
      confidence: bestScore,
      reasons,
    };
  }

  const selected = {
    itemId: bestItem._id.toString(),
    canonical: bestItem.canonical,
    score: bestScore,
    defaultUnit: (bestItem as unknown as { defaultUnit?: string | null }).defaultUnit || null,
    commonUnits:
      ((bestItem as unknown as { commonUnits?: string[] }).commonUnits || []).slice(0),
    priceHints: (
      (bestItem as unknown as {
        priceHints?: Array<{
          unit?: string;
          suggested?: number;
          currency?: string;
          referencePeriod?: string;
          source?: string;
        }>;
      }).priceHints || []
    ).map((hint) => ({
      unit: String(hint.unit || ""),
      suggested: Number(hint.suggested || 0),
      currency: String(hint.currency || "CAD"),
      referencePeriod: String(hint.referencePeriod || ""),
      source: String(hint.source || ""),
    })),
  };

  return {
    selected,
    bestScore,
    topCandidates,
    threshold,
    itemId: selected.itemId,
    itemName: selected.canonical,
    confidence: bestScore,
    reasons,
  };
}

/**
 * Resolve prompt search terms to taxonomy-backed match strings (canonical + name + synonyms).
 * Use for listing search so e.g. "tomato" matches listings with item "Roma tomato", "Cherry tomatoes", etc.
 * @param terms - e.g. ["tomato", "carrot"] from prompt
 * @returns Unique strings to match against listing item/title/description (empty if no taxonomy or no matches)
 */
export async function getProduceMatchTerms(terms: string[]): Promise<string[]> {
  const activeItems = await loadActiveProduceItemsCached();
  if (activeItems.length === 0 || terms.length === 0) return [];

  const out = new Set<string>();
  for (const rawTerm of terms) {
    const normalizedTerm = normalizeLabel(rawTerm);
    if (!normalizedTerm) continue;
    for (const item of activeItems) {
      const candidateTerms = [item.name, item.canonical, ...(item.synonyms || [])];
      for (const c of candidateTerms) {
        const normalizedC = normalizeLabel(c);
        if (getMatchWeight(normalizedTerm, normalizedC) > 0) {
          out.add(item.canonical);
          out.add(item.name);
          for (const s of item.synonyms || []) out.add(s);
          break;
        }
      }
    }
  }
  return Array.from(out).filter(Boolean);
}
