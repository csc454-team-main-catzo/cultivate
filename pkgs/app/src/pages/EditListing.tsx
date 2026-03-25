import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import CFG from "../config";
import { useApi } from "../providers/apiContext";
import { useUser } from "../providers/userContext";
import { ApiStatusError, useListingActions } from "../hooks/useListingActions";
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
  photos?: Array<{ imageId: string }>;
  latLng: [number, number];
  createdBy: { _id: string };
  status: string;
}

export default function EditListing() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { listings: listingsApi } = useApi();
  const { user } = useUser();
  const { updateListing, uploadImage } = useListingActions();
  const [listing, setListing] = useState<ListingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [photos, setPhotos] = useState<Array<{ imageId: string }>>([]);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [item, setItem] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<ListingUnit>("kg");
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
        setPhotos(data.photos?.length ? [...data.photos] : []);
        setSelectedImage(null);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
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

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const imageId = photos[0]?.imageId ?? "";
  const displayImageSrc =
    previewUrl ?? (imageId ? `${CFG.API_URL}/api/images/${imageId}` : null);

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const photosBeforeAttempt = [...photos];

    setToast(null);
    setSubmitError(null);
    setSelectedImage(file);

    const nextPreview = URL.createObjectURL(file);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return nextPreview;
    });

    setUploadingImage(true);
    try {
      const upload = await uploadImage(file);
      setPhotos([{ imageId: upload.imageId }]);
    } catch (err: unknown) {
      setPhotos(photosBeforeAttempt);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setSelectedImage(null);
      if (err instanceof ApiStatusError) {
        if (err.status === 413) {
          setToast("Image too large. Please upload a smaller image.");
          return;
        }
        if (err.status === 415) {
          setToast("Unsupported format. Use JPEG, PNG, or WEBP.");
          return;
        }
        if (err.status === 429) {
          setToast("Too many upload requests. Please try again shortly.");
          return;
        }
      }
      setSubmitError(err instanceof Error ? err.message : "Failed to upload image");
    } finally {
      setUploadingImage(false);
    }
    e.target.value = "";
  }

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
      if (!title.trim()) throw new Error("Title is required");
      if (!description.trim()) throw new Error("Description is required");
      if (listing.type === "supply" && (isNaN(priceNum) || priceNum < 0)) {
        throw new Error("Price per unit must be 0 or greater");
      }

      const body: Parameters<typeof updateListing>[1] = {
        title: title.trim(),
        item: item.trim(),
        description: description.trim(),
        price: isNaN(priceNum) || priceNum < 0 ? 0 : priceNum,
        qty: qtyNum,
        unit,
        ...(photos.length > 0 ? { photos } : {}),
      };

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
          <p className="text-zinc-500 text-sm font-medium">Loading...</p>
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
      {toast && (
        <div className="mb-4 p-3 bg-zinc-50 border border-zinc-200 text-zinc-800 rounded-lg text-sm">
          {toast}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">
            Listing photo
          </label>
          <p className="text-xs text-zinc-500 mb-2">
            Upload to add or replace the image. JPEG, PNG, or WEBP.
          </p>
          <label
            className={`flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed cursor-pointer transition-colors overflow-hidden
              ${
                uploadingImage
                  ? "border-leaf-300 bg-leaf-50"
                  : imageId || previewUrl
                    ? "border-leaf-400 bg-leaf-50"
                    : "border-zinc-300 bg-zinc-50 hover:border-leaf-400 hover:bg-leaf-50"
              }`}
          >
            {displayImageSrc ? (
              <img
                src={displayImageSrc}
                alt="Listing photo"
                className="w-full h-48 object-cover rounded-xl"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 px-4 text-center select-none">
                <svg
                  className="w-10 h-10 text-zinc-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                  />
                </svg>
                <span className="text-sm font-medium text-zinc-700">
                  Click to upload a photo
                </span>
              </div>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageSelect}
              className="sr-only"
            />
          </label>
          {selectedImage && (
            <p
              className={`text-xs mt-1.5 ${uploadingImage ? "text-leaf-600 font-medium" : "text-zinc-500"}`}
            >
              {uploadingImage ? "⏳ Uploading…" : `✓ ${selectedImage.name}`}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Fresh Tomatoes"
            className="input-field"
            maxLength={150}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">
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
          <label className="block text-sm font-medium text-zinc-700 mb-1">
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
          <label className="block text-sm font-medium text-zinc-700 mb-1">
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
          <label className="block text-sm font-medium text-zinc-700 mb-1">
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
          <label className="block text-sm font-medium text-zinc-700 mb-1">
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
        <p className="text-sm text-zinc-600">
          Listing map location follows your profile postal code. Update it in{" "}
          <Link to="/profile" className="text-leaf-700 font-medium hover:underline">
            account settings
          </Link>
          .
        </p>
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
