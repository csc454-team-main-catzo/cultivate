/**
 * Resolve a Canadian postal code to [latitude, longitude] using OpenStreetMap Nominatim.
 * No API key required. Use sparingly (Nominatim usage policy).
 * Format: A1A 1A1 or A1A1A1 (letter-digit-letter, digit-letter-digit).
 */
export async function geocodeZipCode(postalCode: string): Promise<[number, number]> {
  const trimmed = postalCode.trim().toUpperCase();
  if (!trimmed) {
    throw new Error("Postal code is required.");
  }

  // Validate + normalize Canadian postal code: A1A 1A1
  const compact = trimmed.replace(/\s/g, "");
  if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) {
    throw new Error("Please enter a valid Canadian postal code (e.g. K1A 0B1).");
  }
  const normalized = `${compact.slice(0, 3)} ${compact.slice(3)}`;

  const fetchOpts: RequestInit = {
    headers: {
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": "CultivateApp/1.0 (web; postal geocoding)",
    },
  };

  const endpoints = [
    `https://nominatim.openstreetmap.org/search?format=jsonv2&postalcode=${encodeURIComponent(compact)}&countrycodes=ca&limit=5`,
    `https://nominatim.openstreetmap.org/search?format=jsonv2&postalcode=${encodeURIComponent(compact)}&country=Canada&limit=5`,
    `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(normalized)}&countrycodes=ca&limit=5`,
    `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(`${normalized}, Canada`)}&limit=5`,
    `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(`${compact} Canada`)}&limit=5`,
  ];

  for (const url of endpoints) {
    let res: Response;
    try {
      res = await fetch(url, fetchOpts);
    } catch {
      continue;
    }

    if (!res.ok) {
      continue;
    }

    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    if (!Array.isArray(data) || data.length === 0) {
      continue;
    }

    const first = data[0];
    const lat = parseFloat(first?.lat ?? "");
    const lon = parseFloat(first?.lon ?? "");
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      return [lat, lon];
    }
  }

  throw new Error("Postal code not found. Please enter a valid Canadian postal code.");
}
