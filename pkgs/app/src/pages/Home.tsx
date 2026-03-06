import { Navigate } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import { useUser } from "../providers/userContext";
import { TextShimmer } from "@/components/ui/text-shimmer";

/**
 * Home/landing: redirects based on auth state.
 * - Registered user → /listings
 * - Auth0 but not registered → /register
 * - Not authenticated → show simple landing with login CTA
 */
export default function Home() {
  const { isAuthenticated, isLoading: authLoading, loginWithRedirect } = useAuth0();
  const { appUser: user, isLoading: userLoading } = useUser();

  if (authLoading || userLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
          <p className="text-zinc-500 text-sm font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/agent" replace />;
  }

  if (isAuthenticated && !user) {
    return <Navigate to="/register" replace />;
  }

  return (
    <div className="relative overflow-hidden min-h-[calc(100vh-3.5rem)] flex flex-col items-center justify-center w-full px-4 sm:px-6 md:px-8 lg:px-10 min-[1400px]:px-12 box-border">
      <div className="max-w-3xl mx-auto w-full text-center">
        <h1 className="mb-4">
          <img
            src="/logos/cultivate-logo-wordmark.png"
            alt="Cultivate"
            className="h-16 sm:h-20 w-auto mx-auto"
          />
        </h1>
        <p className="text-xl text-zinc-600 mb-10 max-w-xl mx-auto">
          Connect farmers with restaurants. Source local, eat local.
          <br />
          Chat with{" "}
          <TextShimmer
            as="span"
            duration={1.2}
            className="text-xl font-semibold [--base-color:#00674F] [--base-gradient-color:#00A27A] dark:[--base-color:#00674F] dark:[--base-gradient-color:#00A27A]"
          >
            Glean
          </TextShimmer>{" "}
          to source and sell.
        </p>
        <button
          type="button"
          onClick={() => loginWithRedirect()}
          className="inline-flex items-center justify-center rounded-lg bg-zinc-900 text-white text-base font-medium px-6 py-3 hover:bg-zinc-800 transition-colors"
        >
          Get started
        </button>
        <div className="mt-16 flex justify-center gap-8 text-zinc-400 text-sm">
          <span className="flex items-center gap-1.5">🌾 Farmers</span>
          <span className="flex items-center gap-1.5">🍽️ Restaurants</span>
        </div>
      </div>
    </div>
  );
}
