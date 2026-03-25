/**
 * Fetches daily wholesale-to-retail produce prices for the Toronto market
 * from Agriculture and Agri-Food Canada's Infohort Open Data feed.
 *
 * Data source: https://open.canada.ca/data/en/dataset/920bc8e2-de26-4bf6-ac41-ed47962d0ff6
 * JSON endpoint (rolling 55 weeks): https://od-do.agr.gc.ca/DailyWholesalePrices_PrixDeGrossistesQuotidiens.json
 */

const INFOHORT_JSON_URL =
  "https://od-do.agr.gc.ca/DailyWholesalePrices_PrixDeGrossistesQuotidiens.json";

const LBS_TO_KG = 0.453592;

/**
 * Normalised record shape used internally after parsing the AAFC JSON feed.
 * The live API wraps rows in `{ DailyWholesalePrices_PrixDeGrossistesQuotidiens: [...] }`
 * and uses suffixed field names (e.g. CentreEn_CentreAn, CmdtyEn_PrdtAn).
 */
export interface InfohortRecord {
  Date: string;
  CentreEn: string;
  CmdtyEn: string;
  VrtyEn: string;
  GradeEn: string;
  Cntry: string;
  ProvState: string;
  LowPrice: number | null;
  HighPrice: number | null;
  PkgTypeEn: string;
  CntrTypeEn: string;
  PkgQty: number | null;
  PkgWt: number | null;
  UnitMsrEn: string;
  PkgSizeEn: string;
}

const INFOHORT_ARRAY_KEY = "DailyWholesalePrices_PrixDeGrossistesQuotidiens";

function parsePriceField(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function parseOptionalNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/** Unwrap API JSON (object with array key or plain array) into a row array. */
function unwrapInfohortJson(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === "object" && INFOHORT_ARRAY_KEY in (raw as object)) {
    const inner = (raw as Record<string, unknown>)[INFOHORT_ARRAY_KEY];
    if (Array.isArray(inner)) return inner as Record<string, unknown>[];
  }
  throw new Error(
    "Infohort JSON: expected top-level array or object with DailyWholesalePrices_PrixDeGrossistesQuotidiens"
  );
}

/** Map AAFC row keys (suffixed or short) to our normalised record. */
function normaliseInfohortRow(r: Record<string, unknown>): InfohortRecord {
  const centre = String(r.CentreEn_CentreAn ?? r.CentreEn ?? "").trim();
  const cmdty = String(r.CmdtyEn_PrdtAn ?? r.CmdtyEn ?? "").trim();
  return {
    Date: String(r.Date ?? ""),
    CentreEn: centre,
    CmdtyEn: cmdty,
    VrtyEn: String(r.VrtyEn_VrteAn ?? r.VrtyEn ?? "").trim(),
    GradeEn: String(r.GradeEn_CtgryAn ?? r.GradeEn ?? "").trim(),
    Cntry: String(r.Cntry_Pays ?? r.Cntry ?? "").trim(),
    ProvState: String(r.ProvState_ProvEtat ?? r.ProvState ?? "").trim(),
    LowPrice: parsePriceField(r.LowPrice_PrixMin ?? r.LowPrice),
    HighPrice: parsePriceField(r.HighPrice_PrixMax ?? r.HighPrice),
    PkgTypeEn: String(r.PkgTypeEn_EmpqtgAn ?? r.PkgTypeEn ?? "").trim(),
    CntrTypeEn: String(r.CntrTypeEn_TypeCntrAn ?? r.CntrTypeEn ?? "").trim(),
    PkgQty: parseOptionalNumber(r.PkgQty_QtePqt ?? r.PkgQty),
    PkgWt: parseOptionalNumber(r.PkgWt_PdsPqt ?? r.PkgWt),
    UnitMsrEn: String(r.UnitMsrEn_QteUnitAn ?? r.UnitMsrEn ?? "").trim(),
    PkgSizeEn: String(r.PkgSizeEn_TaillePqtAn ?? r.PkgSizeEn ?? "").trim(),
  };
}

/** Normalised per-kg wholesale price for a single commodity on a given date. */
export interface WholesalePriceEntry {
  date: string;
  commodity: string;
  variety: string;
  origin: string;
  lowPricePerKg: number;
  highPricePerKg: number;
  midPricePerKg: number;
  packageDesc: string;
}

/**
 * Map AAFC commodity names (upper-cased) → our produce taxonomy canonical names.
 * The Infohort feed uses title-case English names like "Apples", "Tomatoes".
 */
const COMMODITY_TO_CANONICAL: Record<string, string> = {
  apples: "apple",
  bananas: "banana",
  potatoes: "potato",
  tomatoes: "tomato",
  carrots: "carrot",
  onions: "onion",
  peppers: "pepper",
  lettuce: "lettuce",
  broccoli: "broccoli",
  cauliflower: "cauliflower",
  celery: "celery",
  corn: "corn",
  cucumbers: "cucumber",
  mushrooms: "mushroom",
  "green beans": "green bean",
  peas: "pea",
  spinach: "spinach",
  cabbage: "cabbage",
  beets: "beet",
  turnips: "turnip",
  parsnips: "parsnip",
  rutabagas: "rutabaga",
  squash: "squash",
  eggplant: "eggplant",
  asparagus: "asparagus",
  "brussels sprouts": "brussels sprout",
  garlic: "garlic",
  leeks: "leek",
  radishes: "radish",
  oranges: "orange",
  grapes: "grape",
  strawberries: "strawberry",
  blueberries: "blueberry",
  raspberries: "raspberry",
  blackberries: "blackberry",
  pears: "pear",
  "sweet potatoes": "sweet potato",
  zucchini: "zucchini",
  kale: "kale",
  "bok choy": "bok choy",
  pumpkins: "pumpkin",
};

function normalizePackageWeightKg(
  pkgWt: number | null,
  unit: string,
  pkgQty: number | null
): number | null {
  if (!pkgWt || pkgWt <= 0) return null;
  const u = unit.trim().toUpperCase();
  if (u === "KG" || u === "KGS") return pkgWt;
  if (u === "LBS" || u === "LB") return pkgWt * LBS_TO_KG;
  // AAFC uses "Gr" for grams (e.g. Ctn 12X120 Gr → per-unit grams × count)
  if (u === "GR" || u === "G" || u === "GMS") {
    const qty = pkgQty != null && pkgQty > 0 ? pkgQty : 1;
    const totalGr = pkgWt * qty;
    return totalGr / 1000;
  }
  return null;
}

function pricePerKg(
  price: number,
  packageWeightKg: number
): number {
  if (packageWeightKg <= 0) return 0;
  return Math.round((price / packageWeightKg) * 100) / 100;
}

interface CachedInfohort {
  expiresAt: number;
  records: InfohortRecord[];
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let cache: CachedInfohort = { expiresAt: 0, records: [] };
const DEFAULT_FETCH_TIMEOUT_MS = 45_000;
const MAX_FETCH_RETRIES = 2;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isTimeoutAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException) {
    return err.name === "TimeoutError" || err.name === "AbortError";
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes("timeout") || msg.includes("aborted");
  }
  return false;
}

async function fetchInfohortRecordsWithRetry(timeoutMs: number): Promise<InfohortRecord[]> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt += 1) {
    const attemptTimeoutMs = timeoutMs + attempt * 15_000;
    try {
      const res = await fetch(INFOHORT_JSON_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });
      if (!res.ok) {
        throw new Error(`Infohort fetch failed: ${res.status} ${res.statusText}`);
      }
      const raw: unknown = await res.json();
      const rows = unwrapInfohortJson(raw);
      return rows.map((row) => normaliseInfohortRow(row));
    } catch (err) {
      lastErr = err;
      const canRetry = attempt < MAX_FETCH_RETRIES && isTimeoutAbortError(err);
      if (!canRetry) break;
      // Give the remote endpoint a brief recovery window before retrying.
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Fetch the raw Infohort JSON feed (cached for 6 hours). */
export async function fetchInfohortRecords(): Promise<InfohortRecord[]> {
  const now = Date.now();
  if (cache.expiresAt > now && cache.records.length > 0) {
    return cache.records;
  }

  const fetchTimeoutMs = parsePositiveIntEnv("INFOHORT_FETCH_TIMEOUT_MS", DEFAULT_FETCH_TIMEOUT_MS);
  try {
    const records = await fetchInfohortRecordsWithRetry(fetchTimeoutMs);
    cache = { expiresAt: now + CACHE_TTL_MS, records };
    return records;
  } catch (err) {
    if (cache.records.length > 0) {
      console.warn(
        "[InfohortPrices] Live fetch failed; using cached records:",
        err instanceof Error ? err.message : String(err)
      );
      return cache.records;
    }
    throw err;
  }
}

/**
 * Get the most recent Toronto wholesale prices aggregated per commodity.
 * Returns one entry per canonical produce item with the latest available date.
 */
export async function getTorontoWholesalePrices(): Promise<
  Map<string, { canonical: string; date: string; lowPerKg: number; highPerKg: number; midPerKg: number }>
> {
  const records = await fetchInfohortRecords();

  // Filter for Toronto centre only
  const toronto = records.filter(
    (r) => r.CentreEn?.toLowerCase().includes("toronto")
  );

  // Find the most recent date in the dataset
  const dates = Array.from(new Set(toronto.map((r) => r.Date))).sort().reverse();
  const latestDate = dates[0];
  if (!latestDate) return new Map();

  // Also include one day prior for commodities that might not have today's price
  const recentDates = new Set(dates.slice(0, 3));

  const latestRecords = toronto.filter((r) => recentDates.has(r.Date));

  // Aggregate by canonical commodity
  const aggregated = new Map<
    string,
    { canonical: string; date: string; prices: Array<{ low: number; high: number }> }
  >();

  for (const rec of latestRecords) {
    const cmdty = rec.CmdtyEn?.trim().toLowerCase();
    if (!cmdty) continue;

    const canonical = COMMODITY_TO_CANONICAL[cmdty];
    if (!canonical) continue;

    const low = rec.LowPrice;
    const high = rec.HighPrice;
    if (low == null || high == null || low <= 0 || high <= 0) continue;

    const weightKg = normalizePackageWeightKg(rec.PkgWt, rec.UnitMsrEn || "", rec.PkgQty);
    if (!weightKg || weightKg <= 0) continue;

    const lowPerKg = pricePerKg(low, weightKg);
    const highPerKg = pricePerKg(high, weightKg);
    if (lowPerKg <= 0 || highPerKg <= 0) continue;

    const existing = aggregated.get(canonical);
    if (!existing || rec.Date > existing.date) {
      aggregated.set(canonical, {
        canonical,
        date: rec.Date,
        prices: [{ low: lowPerKg, high: highPerKg }],
      });
    } else if (rec.Date === existing.date) {
      existing.prices.push({ low: lowPerKg, high: highPerKg });
    }
  }

  // Average across varieties/package types for each commodity
  const result = new Map<
    string,
    { canonical: string; date: string; lowPerKg: number; highPerKg: number; midPerKg: number }
  >();

  for (const [key, entry] of aggregated) {
    const avgLow =
      Math.round(
        (entry.prices.reduce((s, p) => s + p.low, 0) / entry.prices.length) * 100
      ) / 100;
    const avgHigh =
      Math.round(
        (entry.prices.reduce((s, p) => s + p.high, 0) / entry.prices.length) * 100
      ) / 100;
    result.set(key, {
      canonical: entry.canonical,
      date: entry.date,
      lowPerKg: avgLow,
      highPerKg: avgHigh,
      midPerKg: Math.round(((avgLow + avgHigh) / 2) * 100) / 100,
    });
  }

  return result;
}
