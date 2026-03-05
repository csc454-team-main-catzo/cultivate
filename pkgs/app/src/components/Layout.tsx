import { Outlet, Link, useLocation } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import { useUser } from "../providers/userContext";

export default function Layout() {
  const { isAuthenticated, loginWithRedirect, logout } = useAuth0();
  const { user } = useUser();
  const location = useLocation();

  function navLinkClass(path: string) {
    const active =
      location.pathname === path || location.pathname.startsWith(path + "/");
    return `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      active
        ? "bg-leaf-600 text-white"
        : "text-earth-200 hover:bg-earth-800/60 hover:text-white"
    }`;
  }

  return (
    <div className="min-h-screen flex flex-col bg-earth-50">
      <nav className="bg-earth-900 border-b border-earth-700/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-6">
              <Link
                to="/"
                className="font-display text-xl text-white tracking-tight hover:text-harvest-200 transition-colors"
              >
                Cultivate
              </Link>
              {user && (
                <div className="flex gap-1">
                  <Link to="/listings" className={navLinkClass("/listings")}>
                    Listings
                  </Link>
                  <Link to="/messages" className={navLinkClass("/messages")}>
                    Messages
                  </Link>
                  <Link to="/quality-gate" className={navLinkClass("/quality-gate")}>
                    Receiving
                  </Link>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              {isAuthenticated ? (
                <>
                  {user && (
                    <span className="text-earth-300 text-xs font-medium px-2.5 py-1 bg-earth-800 rounded-full">
                      {user.role === "farmer" ? "Farmer" : "Restaurant"}
                    </span>
                  )}
                  <span className="text-earth-200 text-sm max-w-[140px] truncate">
                    {user?.name || user?.email}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      logout({ logoutParams: { returnTo: window.location.origin } })
                    }
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-earth-700 text-earth-200 hover:bg-earth-600 hover:text-white transition-colors"
                  >
                    Log out
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => loginWithRedirect()}
                  className="btn-primary"
                >
                  Log in
                </button>
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
