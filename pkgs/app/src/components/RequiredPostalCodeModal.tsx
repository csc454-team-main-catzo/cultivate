import { useEffect, useState } from "react";
import { useApi } from "../providers/apiContext";
import { useUser } from "../providers/userContext";
import { isValidCanadianPostal } from "../utils/canadianPostal";

/**
 * For accounts created before postal was required: block the app until a valid
 * Canadian postal code is saved (same consolidation as registration step 2).
 */
export function RequiredPostalCodeModal() {
  const { user, isLoading, refreshUser } = useUser();
  const { users } = useApi();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsPostal = Boolean(user && !String(user.postalCode ?? "").trim());

  useEffect(() => {
    if (needsPostal) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [needsPostal]);

  if (!needsPostal || isLoading) {
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidCanadianPostal(value)) return;
    setSubmitting(true);
    setError(null);
    try {
      await users.updateCurrentUser({
        updateUserRequest: { postalCode: value.trim() },
      });
      await refreshUser();
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { error?: string } };
        message?: string;
      };
      const msg =
        axiosErr.response?.data?.error ||
        (err instanceof Error ? err.message : null) ||
        "Could not save postal code.";
      setError(typeof msg === "string" ? msg : "Could not save postal code.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="postal-gate-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-zinc-200 p-6 sm:p-8 text-center">
        <div className="mb-2 flex justify-center">
          <img
            src="/logos/cultivate-logo-wordmark.png"
            alt="Cultivate"
            className="h-10 w-auto"
          />
        </div>
        <h2
          id="postal-gate-title"
          className="text-lg font-semibold text-zinc-900 mb-1"
        >
          Confirm your postal code
        </h2>
        <p className="text-zinc-600 text-sm mb-6">
          We use your Canadian postal code for listing location. This matches what
          new members enter at signup.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm text-left">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">Postal code</span>
            <input
              type="text"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              placeholder="e.g. K1A 0B1"
              className="mt-1 w-full px-3 py-2 border border-zinc-300 rounded-lg text-zinc-900"
              maxLength={10}
              autoComplete="postal-code"
              autoFocus
            />
          </label>
          <button
            type="submit"
            disabled={!isValidCanadianPostal(value) || submitting}
            className={`w-full py-3 px-4 rounded-lg text-white font-medium transition-colors ${
              !isValidCanadianPostal(value) || submitting
                ? "bg-zinc-400 cursor-not-allowed"
                : "bg-zinc-900 hover:bg-zinc-800"
            }`}
          >
            {submitting ? "Saving…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
