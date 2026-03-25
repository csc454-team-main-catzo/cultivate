/**
 * Resolve a Canadian postal code to [latitude, longitude] using OpenStreetMap Nominatim.
 *
 * Nominatim requires a valid User-Agent identifying the application; requests without one
 * often get empty results or HTTP 403 (including from local dev).
 *
 * @see https://operations.osmfoundation.org/policies/nominatim/
 */

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";

const NOMINATIM_FETCH_OPTS: RequestInit = {
  headers: {
    Accept: "application/json",
    "Accept-Language": "en",
    // Required by Nominatim usage policy — without this, many requests return no results.
    "User-Agent": "CultivateApp/1.0 (local development; postal geocoding)",
  },
};

function firstLatLon(
  data: Array<{ lat?: string; lon?: string }> | unknown
): [number, number] | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  for (const row of data) {
    const lat = parseFloat(row?.lat ?? "");
    const lon = parseFloat(row?.lon ?? "");
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      return [lat, lon];
    }
  }
  return null;
}

export async function geocodeCanadianPostal(normalizedPostal: string): Promise<[number, number]> {
  const compact = normalizedPostal.replace(/\s/g, "");
  const spaced = `${compact.slice(0, 3)} ${compact.slice(3)}`;

  const queryUrls = [
    `${NOMINATIM_BASE}?format=jsonv2&postalcode=${encodeURIComponent(compact)}&countrycodes=ca&limit=5`,
    `${NOMINATIM_BASE}?format=jsonv2&postalcode=${encodeURIComponent(compact)}&country=Canada&limit=5`,
    `${NOMINATIM_BASE}?format=jsonv2&q=${encodeURIComponent(spaced)}&countrycodes=ca&limit=5`,
    `${NOMINATIM_BASE}?format=jsonv2&q=${encodeURIComponent(`${spaced}, Canada`)}&limit=5`,
    `${NOMINATIM_BASE}?format=jsonv2&q=${encodeURIComponent(`${compact} Canada`)}&limit=5`,
  ];

  for (const url of queryUrls) {
    let res: Response;
    try {
      res = await fetch(url, NOMINATIM_FETCH_OPTS);
    } catch {
      continue;
    }
    if (!res.ok) continue;

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      continue;
    }

    const coords = firstLatLon(data);
    if (coords) return coords;
  }

  throw new Error("Postal code not found. Please enter a valid Canadian postal code.");
}
