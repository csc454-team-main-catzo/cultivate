import { Outlet, Link, useLocation } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import { useUser } from "../providers/userContext";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

export default function Layout() {
  const { isAuthenticated, loginWithRedirect, logout } = useAuth0();
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
      <nav className="sticky top-0 z-50 w-full border-b border-zinc-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-6">
              <Link
                to="/"
                className="text-lg font-semibold text-zinc-900 tracking-tight hover:text-zinc-700 transition-colors"
              >
                Cultivate
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
            <div className="flex items-center gap-3">
              {isAuthenticated ? (
                <>
                  {user && (
                    <span
                      className={`text-xs font-medium px-3 py-1 rounded-full ${
                        user.role === "farmer"
                          ? "bg-[#E0F2EB] text-[#00674F]"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {user.role === "farmer" ? "Farmer" : "Restaurant"}
                    </span>
                  )}
                  <span className="text-sm text-zinc-600 max-w-[140px] truncate">
                    {user?.name || user?.email}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      logout({ logoutParams: { returnTo: window.location.origin } })
                    }
                  >
                    Log out
                  </Button>
                </>
              ) : (
                <Button onClick={() => loginWithRedirect()}>Log in</Button>
              )}
            </div>
          </div>
        </div>
      </nav>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
