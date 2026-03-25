import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import { useApi } from "../providers/apiContext";
import { useUser } from "../providers/userContext";
import CFG from "../config";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import { User } from "lucide-react";

interface ChatParticipant {
  _id: string;
  name?: string;
  email?: string;
  role?: "farmer" | "restaurant";
}

interface ChatMessage {
  _id: string;
  sender: string;
  text: string;
  createdAt: string;
}

interface ChatThreadData {
  _id: string;
  listing: string;
  response: string;
  participants: ChatParticipant[];
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

interface ResponseItem {
  _id: string;
  message: string;
  price: number;
  qty: number;
  unit?: "kg" | "lb" | "count" | "bunch";
  createdBy: { _id: string; name: string; email: string };
  createdAt: string;
}

interface ListingSummary {
  _id: string;
  type: "demand" | "supply";
  title: string;
  item: string;
  description: string;
  price: number;
  qty: number;
  unit?: string;
  status: string;
  createdBy: { _id: string; name: string; email: string; role?: "farmer" | "restaurant" };
}

type LocationState = {
  listing?: ListingSummary;
  response?: ResponseItem;
  from?: "listing" | "messages";
};

export default function ChatThread() {
  const { id: threadId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state as LocationState | null) || undefined;

  const { listings: listingsApi } = useApi();
  const { user } = useUser();
  const { isAuthenticated, getAccessTokenSilently, loginWithRedirect } = useAuth0();

  const [thread, setThread] = useState<ChatThreadData | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(true);

  const [listing, setListing] = useState<ListingSummary | undefined>(
    locationState?.listing
  );
  const [response] = useState<ResponseItem | undefined>(locationState?.response);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const otherParticipant = useMemo(() => {
    if (!thread || !user) return null;
    return thread.participants.find((p) => p._id !== user._id) || null;
  }, [thread, user]);

  useEffect(() => {
    if (!threadId) return;

    let isCancelled = false;
    let intervalId: number | undefined;

    async function fetchThread() {
      if (!isAuthenticated) {
        return;
      }
      try {
        const token = await getAccessTokenSilently({
          authorizationParams: {
            audience: CFG.AUTH0_AUDIENCE,
          },
        });
        const res = await fetch(`${CFG.API_URL}/api/chat/threads/${threadId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `Failed to load chat (${res.status})`);
        }
        const data = (await res.json()) as ChatThreadData;
        if (!isCancelled) {
          setThread(data);
          setThreadError(null);
          setLoadingThread(false);
        }
      } catch (err) {
        if (isCancelled) return;
        console.error("Failed to load chat thread:", err);
        const msg =
          err instanceof Error ? err.message : "Failed to load chat. Please try again.";
        setThreadError(msg);
        setLoadingThread(false);
      }
    }

    setLoadingThread(true);
    fetchThread();
    intervalId = window.setInterval(fetchThread, 3000);

    return () => {
      isCancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [threadId, getAccessTokenSilently, isAuthenticated]);

  useEffect(() => {
    if (thread && !listing) {
      (async () => {
        try {
          const res = await listingsApi.getListing({ id: thread.listing });
          const data = (res as { data?: ListingSummary }).data ?? res;
          setListing(data as ListingSummary);
        } catch (err) {
          console.error("Failed to load listing for chat header:", err);
        }
      })();
    }
  }, [thread, listing, listingsApi]);

  useEffect(() => {
    if (!messagesEndRef.current) return;
    messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread?.messages.length]);

  if (!isAuthenticated) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-8">
        <p className="text-zinc-600 mb-4">
          You need to be logged in to view this chat.
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

  if (loadingThread) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
          <p className="text-zinc-500 text-sm font-medium">Loading chat...</p>
        </div>
      </div>
    );
  }

  if (!thread || threadError) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-8">
        <p className="text-zinc-600 mb-4">
          {threadError || "Chat not found or you do not have access."}
        </p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-zinc-600 font-medium hover:text-zinc-900"
        >
          ← Back
        </button>
      </div>
    );
  }

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !threadId) return;
    setSendError(null);
    setSending(true);
    try {
      const token = await getAccessTokenSilently({
        authorizationParams: {
          audience: CFG.AUTH0_AUDIENCE,
        },
      });
      const res = await fetch(`${CFG.API_URL}/api/chat/threads/${threadId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Failed to send message (${res.status})`);
      }
      const { message } = (await res.json()) as { message: ChatMessage };
      setThread((prev) =>
        prev
          ? {
              ...prev,
              messages: [...prev.messages, message],
            }
          : prev
      );
    } catch (err) {
      console.error("Failed to send message:", err);
      const msg =
        err instanceof Error ? err.message : "Failed to send message. Please try again.";
      setSendError(msg);
    } finally {
      setSending(false);
    }
  }

  const listingLink = listing ? `/listings/${listing._id}` : "/listings";
  const cameFromMessages = locationState?.from === "messages";
  const backHref = cameFromMessages ? "/messages" : listingLink;
  const backLabel = cameFromMessages ? "← Back to messages" : "← Back to listing";

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-8">
      <Link
        to={backHref}
        className="inline-flex items-center gap-1 text-zinc-600 text-sm font-medium hover:text-zinc-900 mb-4"
      >
        {backLabel}
      </Link>

      {listing && (
        <article
          className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 mb-4 cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate(listingLink)}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h1 className="text-2xl font-semibold text-zinc-900">
              {listing.title}
            </h1>
            <span className="text-xs text-zinc-500 capitalize">
              {listing.status}
            </span>
          </div>
          <p className="text-zinc-600 text-sm mb-2 line-clamp-2">
            {listing.description}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
            <span>{listing.item}</span>
            <span>Qty: {listing.qty} {listing.unit ?? "kg"}</span>
            <span>${listing.price.toFixed(2)}/{listing.unit ?? "kg"}</span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            by {listing.createdBy?.name || "Unknown"}
          </p>
          {response && (
            <div className="mt-3 pt-3 border-t border-zinc-200">
              <p className="text-xs uppercase tracking-wide text-zinc-500 mb-1">
                Response
              </p>
              <p className="text-zinc-700 text-sm whitespace-pre-wrap">
                {response.message}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-zinc-500">
                <span>${response.price.toFixed(2)} / {response.unit ?? "kg"}</span>
                <span>Qty: {response.qty} {response.unit ?? "kg"}</span>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                by {response.createdBy?.name || "Unknown"} ·{" "}
                {new Date(response.createdAt).toLocaleString()}
              </p>
            </div>
          )}
        </article>
      )}

      <section className="flex flex-col min-h-[420px] sm:min-h-[480px] max-h-[calc(100vh-12rem)] rounded-2xl border border-zinc-200 bg-zinc-50/50">
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-zinc-200 bg-white rounded-t-2xl">
          <Avatar className="h-9 w-9 shrink-0 rounded-full bg-zinc-200">
            <AvatarFallback className="bg-transparent text-zinc-600">
              <User className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-zinc-900 truncate">
              {otherParticipant ? `Chat with ${otherParticipant.name || otherParticipant.email}` : "Chat"}
            </h2>
            <p className="text-xs text-zinc-500 truncate">
              {otherParticipant?.email ?? "No messages yet. Start the conversation below."}
            </p>
          </div>
        </header>

        <div ref={messagesEndRef} className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 px-4 py-4 min-h-full">
            {thread.messages.length === 0 ? (
              <p className="text-zinc-500 text-sm py-8">
                No messages yet. Start the conversation below.
              </p>
            ) : (
              thread.messages.map((m) => {
                const isMe = user && m.sender === user._id;
                return (
                  <div
                    key={m._id}
                    className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`flex items-end gap-2 max-w-[85%] ${
                        isMe ? "" : "flex-row-reverse"
                      }`}
                    >
                      <div
                        className={
                          isMe
                            ? "rounded-2xl rounded-br-md px-4 py-2.5 bg-zinc-900 text-white text-sm"
                            : "rounded-2xl rounded-bl-md px-4 py-2.5 bg-zinc-100 text-zinc-900 text-sm"
                        }
                      >
                        <p className="whitespace-pre-wrap break-words">{m.text}</p>
                        <p className={`mt-1 text-[11px] opacity-80 ${isMe ? "text-right" : "text-left"}`}>
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <Avatar
                        className={`h-8 w-8 shrink-0 rounded-full ${
                          isMe ? "bg-zinc-900" : "bg-zinc-200"
                        }`}
                      >
                        <AvatarFallback
                          className={isMe ? "bg-transparent text-white" : "bg-transparent text-zinc-600"}
                        >
                          <User className="h-4 w-4" />
                        </AvatarFallback>
                      </Avatar>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="shrink-0 px-4 py-4 border-t border-zinc-200 bg-white rounded-b-2xl">
          {sendError && (
            <p className="text-red-600 text-xs mb-2">{sendError}</p>
          )}
          <PromptInputBox
            minimal
            onSend={handleSend}
            isLoading={sending}
            placeholder="Type a message..."
          />
        </div>
      </section>
    </div>
  );
}

