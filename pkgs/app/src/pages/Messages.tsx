import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import CFG from "../config";
import { useUser } from "../providers/userContext";

interface ChatParticipant {
  _id: string;
  name?: string;
  email?: string;
  role?: "farmer" | "restaurant";
}

interface ListingSummary {
  _id: string;
  title: string;
  item: string;
  price: number;
  qty: number;
  status: string;
  createdBy?: { _id: string; name: string; email: string; role?: "farmer" | "restaurant" };
}

interface ChatThreadListItem {
  _id: string;
  listing: ListingSummary;
  response: string;
  participants: ChatParticipant[];
  lastMessage: {
    _id: string;
    sender: string;
    text: string;
    createdAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export default function Messages() {
  const { isAuthenticated, getAccessTokenSilently, loginWithRedirect } = useAuth0();
  const { user } = useUser();
  const navigate = useNavigate();

  const [threads, setThreads] = useState<ChatThreadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    let isCancelled = false;

    async function fetchThreads() {
      setLoading(true);
      setError(null);
      try {
        const token = await getAccessTokenSilently({
          authorizationParams: {
            audience: CFG.AUTH0_AUDIENCE,
          },
        });
        const res = await fetch(`${CFG.API_URL}/api/chat/threads`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `Failed to load messages (${res.status})`);
        }
        const data = (await res.json()) as ChatThreadListItem[];
        if (!isCancelled) {
          setThreads(data);
        }
      } catch (err) {
        if (isCancelled) return;
        console.error("Failed to load chat threads:", err);
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to load messages. Please try again.";
        setError(msg);
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    fetchThreads();

    return () => {
      isCancelled = true;
    };
  }, [isAuthenticated, getAccessTokenSilently]);

  const hasThreads = threads.length > 0;

  const sortedThreads = useMemo(
    () =>
      [...threads].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ),
    [threads]
  );

  if (!isAuthenticated) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-8">
        <p className="text-zinc-600 mb-4">
          You need to be logged in to view your messages.
        </p>
        <button
          type="button"
          onClick={() => loginWithRedirect()}
          className="btn-primary"
        >
          Log in
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">Messages</h1>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-leaf-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-earth-500 text-sm font-medium">
              Loading your conversations...
            </p>
          </div>
        </div>
      ) : !hasThreads ? (
        <div className="card p-5 text-center">
          <p className="text-earth-600 text-sm mb-2">
            You don&apos;t have any conversations yet.
          </p>
          <Link
            to="/listings"
            className="inline-flex items-center justify-center mt-1 text-leaf-600 text-sm font-medium hover:text-leaf-700"
          >
            Browse listings
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {sortedThreads.map((thread) => {
            const listing = thread.listing;
            const lastMessage = thread.lastMessage;
            const otherParticipant =
              user &&
              thread.participants.find((p) => p._id !== user._id) ||
              thread.participants[0];

            return (
              <li key={thread._id}>
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/chat/${thread._id}`, {
                      state: {
                        listing,
                        from: "messages" as const,
                      },
                    })
                  }
                  className="w-full text-left card p-4 hover:bg-earth-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="font-display text-sm sm:text-base text-earth-900 truncate">
                          {listing?.title || "Listing"}
                        </h2>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-earth-100 text-earth-600 capitalize">
                          {listing?.status || "open"}
                        </span>
                      </div>
                      <p className="text-xs text-earth-500 mb-1 truncate">
                        {listing?.item} · Qty: {listing?.qty} · $
                        {listing?.price.toFixed(2)}
                      </p>
                      {lastMessage && (
                        <p className="text-sm text-earth-700 line-clamp-1">
                          {lastMessage.text}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {otherParticipant && (
                        <p className="text-xs text-earth-500 max-w-[120px] text-right truncate">
                          With{" "}
                          <span className="font-medium">
                            {otherParticipant.name || otherParticipant.email}
                          </span>
                        </p>
                      )}
                      {(lastMessage || thread.updatedAt) && (
                        <p className="text-[11px] text-earth-400">
                          {new Date(
                            lastMessage?.createdAt ?? thread.updatedAt
                          ).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

