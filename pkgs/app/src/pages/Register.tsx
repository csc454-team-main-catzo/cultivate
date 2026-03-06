import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useRegistration } from "../hooks/useRegistration";
import { useUser } from "../providers/userContext";

export default function Register() {
  const navigate = useNavigate();
  const { register, isLoading, error } = useRegistration();
  const { user } = useUser();
  const [selectedRole, setSelectedRole] = useState<"farmer" | "restaurant" | null>(null);

  // Already registered — redirect to listings
  if (user) {
    return <Navigate to="/" replace />;
  }

  async function handleRegister() {
    if (!selectedRole) return;

    try {
      await register(selectedRole);
      navigate("/", { replace: true });
    } catch {
      // error is set by the hook
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold mb-2">Welcome to Cultivate 🌱</h1>
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
        onClick={handleRegister}
        disabled={!selectedRole || isLoading}
        className={`w-full py-3 px-4 rounded-md text-white font-medium transition-colors ${
          !selectedRole || isLoading
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-gray-800 hover:bg-gray-900"
        }`}
      >
        {isLoading ? "Setting up your account..." : "Continue"}
      </button>
    </div>
  );
}
