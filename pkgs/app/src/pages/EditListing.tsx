import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApi } from "../providers/apiContext";
import { useUser } from "../providers/userContext";
import { useListingActions } from "../hooks/useListingActions";
import { geocodeZipCode } from "../utils/geocode";
import GhostTextarea from "../components/GhostTextarea";
import { getListingDescriptionSuggestion } from "../utils/suggestions";

type ListingUnit = "kg" | "lb" | "count" | "bunch";

interface ListingData {
  _id: string;
  type: "demand" | "supply";
  title: string;
  item: string;
  description: string;
  price: number;
  qty: number;
  unit?: ListingUnit;
  latLng: [number, number];
  createdBy: { _id: string };
  status: string;
}

export default function EditListing() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { listings: listingsApi } = useApi();
  const { user } = useUser();
  const { updateListing } = useListingActions();
  const [listing, setListing] = useState<ListingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [item, setItem] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<ListingUnit>("kg");
  const [zipCode, setZipCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const getDescriptionSuggestion = useCallback(
    (text: string) =>
      getListingDescriptionSuggestion(text, {
        itemName: item,
        qty,
        unit,
        price,
        priceUnit: unit,
      }),
    [item, qty, unit, price]
  );

  useEffect(() => {
    const listingId = id;
    if (!listingId) return;
    async function fetchListing() {
      setLoading(true);
      setError(null);
      try {
        const response = await listingsApi.getListing({ id: listingId as string });
        const raw = (response as { data?: unknown }).data ?? response;
        const data = raw as ListingData;
        setListing(data);
        setTitle(data.title);
        setItem(data.item);
        setDescription(data.description);
        setPrice(String(data.price));
        setQty(String(data.qty));
        if (data.unit) setUnit(data.unit);
      } catch {
        setError("Could not load listing.");
      } finally {
        setLoading(false);
      }
    }
    fetchListing();
  }, [id, listingsApi]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const listingId = id;
    if (!listingId || !listing) return;
    if (listing.createdBy._id !== user?._id) {
      setSubmitError("You can only edit your own listing.");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);

    try {
      const priceNum = parseFloat(price);
      const qtyNum = parseInt(qty, 10);
      if (isNaN(qtyNum) || qtyNum < 1) throw new Error("Quantity must be at least 1");
      if (!item.trim()) throw new Error("Item is required");
      if (!description.trim()) throw new Error("Description is required");
      if (listing.type === "supply" && (isNaN(priceNum) || priceNum < 0)) {
        throw new Error("Price per unit must be 0 or greater");
      }

      const body: Parameters<typeof updateListing>[1] = {
        title: title.trim() || undefined,
        item: item.trim(),
        description: description.trim(),
        price: isNaN(priceNum) || priceNum < 0 ? 0 : priceNum,
        qty: qtyNum,
        unit,
      };

      if (zipCode.trim()) {
        body.latLng = await geocodeZipCode(zipCode);
      }

      await updateListing(listingId, body);
      navigate(`/listings/${listingId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to update.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-leaf-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-earth-500 text-sm font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-8">
        <p className="text-zinc-600 mb-4">{error || "Listing not found."}</p>
        <Link to="/listings" className="text-leaf-600 font-medium hover:text-leaf-700">
          ← Back to listings
        </Link>
      </div>
    );
  }

  if (listing.createdBy._id !== user?._id) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-8">
        <p className="text-zinc-600 mb-4">You can only edit your own listing.</p>
        <Link to={`/listings/${listing._id}`} className="text-leaf-600 font-medium hover:text-leaf-700">
          ← Back to listing
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-8">
      <Link
        to={`/listings/${id}`}
        className="inline-flex items-center gap-1 text-zinc-600 text-sm font-medium hover:text-zinc-900 mb-6"
      >
        ← Back to listing
      </Link>
      <h1 className="text-2xl font-semibold text-zinc-900 mb-6">Edit listing</h1>

      {submitError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {listing.type === "demand" && (
          <div>
            <label className="block text-sm font-medium text-earth-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input-field"
              maxLength={150}
            />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-earth-700 mb-1">
            Item <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={item}
            onChange={(e) => setItem(e.target.value)}
            className="input-field"
            maxLength={100}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-earth-700 mb-1">
            Description <span className="text-red-500">*</span>
          </label>
          <GhostTextarea
            value={description}
            onChange={(v) => setDescription(v)}
            getSuggestion={getDescriptionSuggestion}
            rows={3}
            maxLength={2000}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-earth-700 mb-1">
            Unit <span className="text-red-500">*</span>
          </label>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as ListingUnit)}
            className="input-field"
          >
            <option value="kg">kg</option>
            <option value="lb">lb</option>
            <option value="count">count</option>
            <option value="bunch">bunch</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-earth-700 mb-1">
            Price per {unit} ($)
          </label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            min="0"
            step="0.01"
            className="input-field"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-earth-700 mb-1">
            Quantity <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            min="1"
            step="1"
            className="input-field"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-earth-700 mb-1">
            Change location (postal code)
          </label>
          <input
            type="text"
            value={zipCode}
            onChange={(e) => setZipCode(e.target.value)}
            placeholder="Leave blank to keep current location"
            className="input-field"
            maxLength={10}
          />
          <p className="text-earth-500 text-xs mt-1">
            Enter a new Canadian postal code to update your listing’s location.
          </p>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary w-full sm:w-auto"
        >
          {submitting ? "Saving..." : "Save changes"}
        </button>
      </form>
    </div>
  );
}
