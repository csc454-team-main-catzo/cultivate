import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useRegistration } from "../hooks/useRegistration";
import { useUser } from "../providers/userContext";
import { isValidCanadianPostal } from "../utils/canadianPostal";

export default function Register() {
  const navigate = useNavigate();
  const { register, isLoading, error } = useRegistration();
  const { user } = useUser();
  const [step, setStep] = useState<"role" | "postal">("role");
  const [selectedRole, setSelectedRole] = useState<"farmer" | "restaurant" | null>(null);
  const [postalCode, setPostalCode] = useState("");

  // Already registered — redirect to listings
  if (user) {
    return <Navigate to="/" replace />;
  }

  async function handleCompleteRegistration() {
    if (!selectedRole || !isValidCanadianPostal(postalCode)) return;

    try {
      await register(selectedRole, postalCode.trim());
      navigate("/", { replace: true });
    } catch {
      // error is set by the hook
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold mb-2 flex flex-wrap items-center justify-center gap-2">
        Welcome to{" "}
        <img
          src="/logos/cultivate-logo-wordmark.png"
          alt="Cultivate"
          className="h-12 w-auto inline-block align-middle"
        />{" "}
        🌱
      </h1>

      {step === "role" && (
        <>
          <p className="text-gray-600 mb-8">How will you be using the platform?</p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
              {error.message}
            </div>
          )}

          <div className="flex gap-4 mb-8">
            <button
              type="button"
              onClick={() => setSelectedRole("farmer")}
              className={`flex-1 p-6 rounded-lg border-2 transition-colors ${
                selectedRole === "farmer"
                  ? "border-[#00674F] bg-[#E0F2EB]"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="text-3xl mb-2">🌾</div>
              <div className="font-semibold">Farmer</div>
              <div className="text-sm text-gray-500 mt-1">I grow and sell produce</div>
            </button>

            <button
              type="button"
              onClick={() => setSelectedRole("restaurant")}
              className={`flex-1 p-6 rounded-lg border-2 transition-colors ${
                selectedRole === "restaurant"
                  ? "border-blue-600 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="text-3xl mb-2">🍽️</div>
              <div className="font-semibold">Restaurant</div>
              <div className="text-sm text-gray-500 mt-1">I source local ingredients</div>
            </button>
          </div>

          <button
            type="button"
            onClick={() => selectedRole && setStep("postal")}
            disabled={!selectedRole}
            className={`w-full py-3 px-4 rounded-md text-white font-medium transition-colors ${
              !selectedRole ? "bg-gray-400 cursor-not-allowed" : "bg-gray-800 hover:bg-gray-900"
            }`}
          >
            Continue
          </button>
        </>
      )}

      {step === "postal" && (
        <>
          <p className="text-gray-600 mb-2">What is your Canadian postal code?</p>
          <p className="text-gray-500 text-sm mb-6">
            We use this for listing location. You can change it later in your profile.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm">
              {error.message}
            </div>
          )}

          <label className="block text-left mb-4">
            <span className="text-sm font-medium text-gray-700">Postal code</span>
            <input
              type="text"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="e.g. K1A 0B1"
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
              maxLength={10}
              autoComplete="postal-code"
            />
          </label>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep("role")}
              className="flex-1 py-3 px-4 rounded-md border border-gray-300 font-medium text-gray-800 hover:bg-gray-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleCompleteRegistration}
              disabled={!isValidCanadianPostal(postalCode) || isLoading}
              className={`flex-1 py-3 px-4 rounded-md text-white font-medium transition-colors ${
                !isValidCanadianPostal(postalCode) || isLoading
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-gray-800 hover:bg-gray-900"
              }`}
            >
              {isLoading ? "Setting up your account..." : "Create account"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
