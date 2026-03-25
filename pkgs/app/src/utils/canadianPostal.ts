/** Canadian postal code: letter-digit-letter-digit-letter-digit (e.g. K1A 0B1). */
export function isValidCanadianPostal(s: string): boolean {
  const c = s.trim().toUpperCase().replace(/\s/g, "");
  return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(c);
}
