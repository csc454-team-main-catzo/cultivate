import { Outlet, Link, useLocation } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import { useUser } from "../providers/userContext";
import { Button } from "./ui/button";
import { ProfileDropdown } from "./ui/profile-dropdown";
import { cn } from "@/lib/utils";
import { RequiredPostalCodeModal } from "./RequiredPostalCodeModal";

export default function Layout() {
  const { isAuthenticated, loginWithRedirect } = useAuth0();
  const { user } = useUser();
  const location = useLocation();

  function navLinkClass(path: string) {
    const active =
      location.pathname === path || location.pathname.startsWith(path + "/");
    return cn(
      "px-3 py-2 rounded-lg text-sm font-medium transition-colors",
      active ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <RequiredPostalCodeModal />
      <nav className="sticky top-0 z-50 w-full border-b border-zinc-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="w-full px-4 sm:px-6 md:px-8 lg:px-10">
          <div className="flex items-center justify-between h-14 gap-4">
            <div className="flex items-center gap-6">
              <Link
                to="/"
                className="flex items-center gap-1 text-zinc-900 hover:opacity-80 transition-opacity"
                aria-label="Cultivate home"
              >
                <img
                  src="/logos/cultivate-logo-wordmark.png"
                  alt="Cultivate"
                  className="h-9 w-auto"
                />
              </Link>
              {user && (
                <div className="flex gap-1">
                  <Link to="/agent" className={navLinkClass("/agent")}>
                    Ask Glean
                  </Link>
                  <Link to="/listings" className={navLinkClass("/listings")}>
                    Listings
                  </Link>
                  <Link to="/messages" className={navLinkClass("/messages")}>
                    Messages
                  </Link>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {isAuthenticated && user ? (
                <>
                  <span
                    className={cn(
                      "text-xs font-medium px-3 py-1 rounded-full shrink-0",
                      user.role === "farmer"
                        ? "bg-[#E0F2EB] text-[#00674F]"
                        : "bg-blue-100 text-blue-800"
                    )}
                  >
                    {user.role === "farmer" ? "Farmer" : "Restaurant"}
                  </span>
                  <ProfileDropdown
                    data={{
                      name: user.name ?? "User",
                      email: user.email ?? "",
                      avatar: user.avatar ?? undefined,
                    }}
                  />
                </>
              ) : isAuthenticated ? (
                <span className="text-sm text-zinc-500">Loading...</span>
              ) : (
                <Button onClick={() => loginWithRedirect()}>Log in</Button>
              )}
            </div>
          </div>
        </div>
      </nav>
      <main className="flex-1 w-full max-w-[100vw] overflow-x-hidden box-border">
        <Outlet />
      </main>
    </div>
  );
}
