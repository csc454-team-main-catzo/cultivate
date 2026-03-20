import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import { useApi } from "../providers/apiContext";
import { useUser } from "../providers/userContext";
import { useListingActions } from "../hooks/useListingActions";
import CFG from "../config";
import GhostTextarea from "../components/GhostTextarea";
import { getMessageSuggestion } from "../utils/suggestions";

type ResponseUnit = "kg" | "lb" | "count" | "bunch";

interface ResponseItem {
  _id: string;
  message: string;
  price: number;
  qty: number;
  unit?: ResponseUnit;
  createdBy: { _id: string; name: string; email: string };
  createdAt: string;
}

interface ListingDetailData {
  _id: string;
  type: "demand" | "supply";
  title: string;
  item: string;
  description: string;
  price: number;
  qty: number;
  unit?: string;
  photos?: Array<{ imageId: string }>;
  deliveryWindow?: { startAt: string; endAt: string };
  status: string;
  matchedResponseId: string | null;
  createdBy: { _id: string; name: string; email: string; role?: "farmer" | "restaurant" };
  responses: ResponseItem[];
  createdAt: string;
}

export default function ListingDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as { from?: string } | null;
  const { listings: listingsApi } = useApi();
  const { user } = useUser();
  const { isAuthenticated, getAccessTokenSilently, loginWithRedirect } = useAuth0();
  const {
    deleteListing,
    updateListing,
    matchListingResponse,
    deleteListingResponse,
  } = useListingActions();
  const [listing, setListing] = useState<ListingDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Respond form
  const [message, setMessage] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<ResponseUnit>("kg");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Delete
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Delete response
  const [responseToDelete, setResponseToDelete] = useState<ResponseItem | null>(null);
  const [deletingResponse, setDeletingResponse] = useState(false);
  const [deleteResponseError, setDeleteResponseError] = useState<string | null>(null);

  // Match / Fulfilled
  const [matchingResponseId, setMatchingResponseId] = useState<string | null>(null);
  const [fulfilling, setFulfilling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  // Placed before early returns to satisfy Rules of Hooks. listing is null
  // until the fetch resolves, so optional chaining with fallbacks is used.
  const getResponseSuggestion = useCallback(
    (text: string) =>
      getMessageSuggestion(text, {
        itemName: listing?.item ?? "",
        qty: String(listing?.qty ?? ""),
        price: String(listing?.price ?? ""),
      }),
    [listing?.item, listing?.qty, listing?.price]
  );

  useEffect(() => {
    const listingId = id;
    if (!listingId) return;
    async function fetchListing() {
      setLoading(true);
      setError(null);
      try {
        const response = await listingsApi.getListing({ id: listingId as string });
        const data = (response as { data?: ListingDetailData }).data ?? response;
        setListing(data as ListingDetailData);
      } catch (err) {
        console.error("Failed to fetch listing:", err);
        setError("Could not load listing.");
      } finally {
        setLoading(false);
      }
    }
    fetchListing();
  }, [id, listingsApi]);

  async function handleSubmitResponse(e: React.FormEvent) {
    e.preventDefault();
    const listingId = id;
    if (!listingId || !listing) return;
    setSubmitError(null);
    setSubmitting(true);

    const priceNum = parseFloat(price);
    const qtyNum = parseInt(qty, 10);
    if (message.trim().length === 0) {
      setSubmitError("Message is required.");
      setSubmitting(false);
      return;
    }
    if (isNaN(priceNum) || priceNum < 0) {
      setSubmitError("Price must be 0 or greater.");
      setSubmitting(false);
      return;
    }
    if (isNaN(qtyNum) || qtyNum < 1) {
      setSubmitError("Quantity must be at least 1.");
      setSubmitting(false);
      return;
    }

    try {
      const response = await listingsApi.createListingResponse({
        id: listingId,
        createListingResponseRequest: {
          message: message.trim(),
          price: priceNum,
          qty: qtyNum,
          unit,
        },
      });
      const updated = (response as { data?: ListingDetailData }).data ?? response;
      setListing(updated as ListingDetailData);
      setMessage("");
      setPrice("");
      setQty("");
      setUnit("kg");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      setSubmitError(msg || "Failed to submit response. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    const listingId = id;
    if (!listingId) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteListing(listingId);
      navigate("/listings");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  async function handleDeleteResponse() {
    const listingId = id;
    if (!listingId || !responseToDelete) return;
    setDeleteResponseError(null);
    setDeletingResponse(true);
    try {
      const updated = await deleteListingResponse(listingId, responseToDelete._id);
      const data = (updated as { data?: ListingDetailData }).data ?? updated;
      setListing(data as ListingDetailData);
      setResponseToDelete(null);
    } catch (err) {
      setDeleteResponseError(
        err instanceof Error ? err.message : "Failed to delete response."
      );
    } finally {
      setDeletingResponse(false);
    }
  }

  async function handleMatch(responseId: string) {
    const listingId = id;
    if (!listingId) return;
    setActionError(null);
    setMatchingResponseId(responseId);
    try {
      const updated = await matchListingResponse(listingId, responseId);
      setListing(updated as ListingDetailData);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to match.");
    } finally {
      setMatchingResponseId(null);
    }
  }

  async function handleMarkFulfilled() {
    const listingId = id;
    if (!listingId) return;
    setActionError(null);
    setFulfilling(true);
    try {
      const updated = await updateListing(listingId, { status: "fulfilled" });
      setListing(updated as ListingDetailData);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update.");
    } finally {
      setFulfilling(false);
    }
  }

  async function handleOpenChat(response: ResponseItem) {
    if (!listing) return;

    setChatError(null);

    if (!isAuthenticated) {
      await loginWithRedirect({
        appState: { returnTo: window.location.pathname },
      });
      return;
    }

    try {
      const token = await getAccessTokenSilently({
        authorizationParams: {
          audience: CFG.AUTH0_AUDIENCE,
        },
      });

      const res = await fetch(`${CFG.API_URL}/api/chat/threads/ensure`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          listingId: listing._id,
          responseId: response._id,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Failed to open chat (${res.status})`);
      }

      const thread = (await res.json()) as { _id: string };
      navigate(`/chat/${thread._id}`, {
        state: {
          listing,
          response,
          from: "listing" as const,
        },
      });
    } catch (err) {
      console.error("Failed to open chat:", err);
      const msg =
        err instanceof Error ? err.message : "Failed to open chat. Please try again.";
      setChatError(msg);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-leaf-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-500 text-sm font-medium">Loading listing...</p>
        </div>
      </div>
    );
  }

  const cameFromChatEarly = locationState?.from === "chat";
  const backHrefEarly = cameFromChatEarly ? "/agent" : "/listings";
  const backLabelEarly = cameFromChatEarly ? "← Back to chat" : "← Back to listings";

  if (error || !listing) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-8">
        <p className="text-zinc-600 mb-4">{error || "Listing not found."}</p>
        <Link to={backHrefEarly} className="text-leaf-600 font-medium hover:text-leaf-700">
          {backLabelEarly}
        </Link>
      </div>
    );
  }

  const isOpen = listing.status === "open";
  const isOwner = user?._id === listing.createdBy?._id;
  const canRespond = isOpen && !isOwner;
  const primaryImageId = listing.photos?.[0]?.imageId;
  const primaryImageUrl = primaryImageId
    ? `${CFG.API_URL}/api/images/${primaryImageId}`
    : null;

  const cameFromChat = locationState?.from === "chat";
  const backHref = cameFromChat ? "/agent" : "/listings";
  const backLabel = cameFromChat ? "← Back to chat" : "← Back to listings";

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-8">
      <Link
        to={backHref}
        className="inline-flex items-center gap-1 text-zinc-600 text-sm font-medium hover:text-leaf-600 mb-6"
      >
        {backLabel}
      </Link>

      <article className="card p-5 sm:p-6 mb-6">
        {primaryImageUrl && (
          <img
            src={primaryImageUrl}
            alt={listing.item}
            className="w-full h-64 object-cover rounded-lg border border-zinc-200 mb-4"
          />
        )}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span
            className={`inline-block text-xs font-medium px-3 py-1 rounded-full ${
              listing.createdBy?.role === "restaurant"
                ? "bg-blue-100 text-blue-800"
                : "bg-[#E0F2EB] text-[#00674F]"
            }`}
          >
            {listing.createdBy?.role === "restaurant"
              ? "Restaurant"
              : listing.createdBy?.role === "farmer"
                ? "Farmer"
                : listing.type === "demand"
                  ? "Restaurant"
                  : "Farmer"}
          </span>
          <span className="text-xs text-zinc-500 capitalize">{listing.status}</span>
        </div>
        <h1 className="text-2xl font-semibold text-zinc-900 mb-2">
          {listing.title}
        </h1>
        <p className="text-zinc-600 text-sm mb-3">{listing.description}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
          <span>{listing.item}</span>
          <span>Qty: {listing.qty} {listing.unit ?? "kg"}</span>
          <span>${listing.price.toFixed(2)}/{listing.unit ?? "kg"}</span>
        </div>
        {listing.deliveryWindow?.startAt && listing.deliveryWindow?.endAt && (
          <p className="text-sm text-zinc-600 mt-2">
            Delivery window:{" "}
            {new Date(listing.deliveryWindow.startAt).toLocaleString(undefined, {
              dateStyle: "short",
              timeStyle: "short",
            })}{" "}
            –{" "}
            {new Date(listing.deliveryWindow.endAt).toLocaleString(undefined, {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </p>
        )}
        <p className="text-xs text-zinc-400 mt-2">
          by {listing.createdBy?.name || "Unknown"}
        </p>
        {isOwner && (
          <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-zinc-200">
            <Link
              to={`/listings/${listing._id}/edit`}
              className="btn-secondary text-sm"
            >
              Edit listing
            </Link>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
              aria-label="Delete listing"
            >
              <svg
                aria-hidden="true"
                className="w-4 h-4"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M7.5 8.75V14.25M12.5 8.75V14.25M4.375 5.75H15.625M5.625 5.75L6.25 15.5C6.25 16.1904 6.80964 16.75 7.5 16.75H12.5C13.1904 16.75 13.75 16.1904 13.75 15.5L14.375 5.75M8.75 3.25H11.25C11.9404 3.25 12.5 3.80964 12.5 4.5V5.75H7.5V4.5C7.5 3.80964 8.05964 3.25 8.75 3.25Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        )}
      </article>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center p-4 bg-zinc-900/50" role="dialog" aria-modal="true" aria-labelledby="delete-title">
          <div className="card p-6 max-w-sm w-full">
            <h2 id="delete-title" className="font-display text-lg text-zinc-900 mb-2">
              Delete this listing?
            </h2>
            <p className="text-zinc-600 text-sm mb-4">
              This cannot be undone. All responses will be removed.
            </p>
            {deleteError && (
              <p className="text-red-600 text-sm mb-4">{deleteError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="btn-secondary"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {actionError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {actionError}
        </div>
      )}
      {chatError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {chatError}
        </div>
      )}

      {responseToDelete && (
        <div
          className="fixed inset-0 z-10 flex items-center justify-center p-4 bg-zinc-900/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-response-title"
        >
          <div className="card p-6 max-w-sm w-full">
            <h2
              id="delete-response-title"
              className="font-display text-lg text-zinc-900 mb-2"
            >
              Delete your response?
            </h2>
            <p className="text-zinc-600 text-sm mb-4">
              This cannot be undone. The response will be removed from this listing.
            </p>
            {deleteResponseError && (
              <p className="text-red-600 text-sm mb-4">{deleteResponseError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setResponseToDelete(null)}
                className="btn-secondary"
                disabled={deletingResponse}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteResponse}
                disabled={deletingResponse}
                className="px-4 py-2 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deletingResponse ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Responses */}
      <section className="mb-6">
        <h2 className="font-display text-lg text-zinc-900 mb-3">
          Responses {listing.responses?.length ? `(${listing.responses.length})` : ""}
        </h2>
        {!listing.responses?.length ? (
          <p className="text-zinc-500 text-sm">No responses yet.</p>
        ) : (
          <ul className="space-y-3">
            {listing.responses.map((r) => {
              const isMatched =
                listing.matchedResponseId != null &&
                r._id === listing.matchedResponseId;
              const canMatch =
                isOwner && listing.status === "open" && !isMatched;
              const isResponseOwner = user?._id === r.createdBy?._id;
              const canChat =
                isOwner || isResponseOwner;
              return (
                <li
                  key={r._id}
                  className={`card p-4 border-zinc-100 ${
                    isMatched ? "ring-2 ring-leaf-500 bg-leaf-50/50" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-zinc-700 text-sm whitespace-pre-wrap">
                        {r.message}
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-zinc-500">
                        <span>${r.price.toFixed(2)} / {r.unit ?? "kg"}</span>
                        <span>Qty: {r.qty} {r.unit ?? "kg"}</span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-1">
                        by {r.createdBy?.name || "Unknown"} ·{" "}
                        {new Date(r.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {isMatched && (
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-leaf-200 text-leaf-800">
                          Matched
                        </span>
                      )}
                      {canMatch && (
                        <button
                          type="button"
                          onClick={() => handleMatch(r._id)}
                          disabled={matchingResponseId !== null}
                          className="btn-primary text-sm py-1.5 px-3"
                        >
                          {matchingResponseId === r._id
                            ? "Matching..."
                            : "Match"}
                        </button>
                      )}
                      {isResponseOwner && (
                        <button
                          type="button"
                          onClick={() => setResponseToDelete(r)}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
                          aria-label="Delete your response"
                        >
                          <svg
                            aria-hidden="true"
                            className="w-4 h-4"
                            viewBox="0 0 20 20"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M7.5 8.75V14.25M12.5 8.75V14.25M4.375 5.75H15.625M5.625 5.75L6.25 15.5C6.25 16.1904 6.80964 16.75 7.5 16.75H12.5C13.1904 16.75 13.75 16.1904 13.75 15.5L14.375 5.75M8.75 3.25H11.25C11.9404 3.25 12.5 3.80964 12.5 4.5V5.75H7.5V4.5C7.5 3.80964 8.05964 3.25 8.75 3.25Z"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      )}
                      {canChat && (
                        <button
                          type="button"
                          onClick={() => handleOpenChat(r)}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-zinc-200 text-zinc-700 hover:bg-zinc-50 transition-colors"
                          aria-label="Open chat"
                        >
                          <svg
                            aria-hidden="true"
                            className="w-4 h-4"
                            viewBox="0 0 20 20"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M4 5.5C4 4.67157 4.67157 4 5.5 4H14.5C15.3284 4 16 4.67157 16 5.5V10.5C16 11.3284 15.3284 12 14.5 12H8.41421L5.70711 14.7071C5.07714 15.3371 4 14.891 4 13.9929V5.5Z"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {isOwner && listing.status === "matched" && (
          <div className="mt-4">
            <button
              type="button"
              onClick={handleMarkFulfilled}
              disabled={fulfilling}
              className="btn-primary"
            >
              {fulfilling ? "Updating..." : "Mark as fulfilled"}
            </button>
            <p className="text-zinc-500 text-xs mt-1">
              Mark this listing as fulfilled when the exchange is complete.
            </p>
          </div>
        )}
      </section>

      {/* Respond form */}
      {canRespond && (
        <section className="card p-5 sm:p-6">
          <h2 className="font-display text-lg text-zinc-900 mb-4">Respond to this listing</h2>
          {submitError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {submitError}
            </div>
          )}
          <form onSubmit={handleSubmitResponse} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                Your message <span className="text-red-500">*</span>
              </label>
              <GhostTextarea
                value={message}
                onChange={(v) => setMessage(v)}
                getSuggestion={getResponseSuggestion}
                placeholder="Describe your offer or interest..."
                rows={3}
                maxLength={2000}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Your offered price per unit ($)
                </label>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="input-field"
                />
                <p className="text-zinc-500 text-xs mt-1">Price you’re offering per {unit}.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Quantity <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    placeholder="1"
                    min="1"
                    step="1"
                    className="input-field flex-1 min-w-0"
                  />
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as ResponseUnit)}
                    className="input-field w-24 shrink-0"
                    aria-label="Unit"
                  >
                    <option value="kg">kg</option>
                    <option value="lb">lb</option>
                    <option value="count">count</option>
                    <option value="bunch">bunch</option>
                  </select>
                </div>
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full sm:w-auto"
            >
              {submitting ? "Sending..." : "Send response"}
            </button>
          </form>
        </section>
      )}

      {isOpen && isOwner && (
        <p className="text-zinc-500 text-sm mt-4">
          You created this listing. Match with a response above, or use Edit/Delete to manage it.
        </p>
      )}
      {listing.status === "matched" && isOwner && (
        <p className="text-zinc-500 text-sm mt-4">
          You've matched with a response. Mark as fulfilled when the exchange is complete.
        </p>
      )}
    </div>
  );
}
