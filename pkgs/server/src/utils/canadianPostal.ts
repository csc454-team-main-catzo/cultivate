import * as v from "valibot";

const CANADIAN_POSTAL_RE = /^[A-Z]\d[A-Z]\d[A-Z]\d$/;

/** Normalize to `A1A 1A1` uppercase. */
export function normalizeCanadianPostal(input: string): string {
  const compact = input.trim().toUpperCase().replace(/\s/g, "");
  if (!CANADIAN_POSTAL_RE.test(compact)) {
    throw new Error("Invalid Canadian postal code");
  }
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

export const CanadianPostalSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, "Postal code is required"),
  v.check(
    (s) => {
      const c = s.toUpperCase().replace(/\s/g, "");
      return CANADIAN_POSTAL_RE.test(c);
    },
    "Enter a valid Canadian postal code (e.g. K1A 0B1)"
  ),
  v.transform((s) => normalizeCanadianPostal(s))
);
