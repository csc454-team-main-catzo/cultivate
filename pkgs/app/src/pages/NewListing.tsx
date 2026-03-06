import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "../providers/userContext";
import { geocodeZipCode } from "../utils/geocode";
import {
  ApiStatusError,
  type DraftFromImageResponse,
  type DraftSuggestedFields,
  useListingActions,
} from "../hooks/useListingActions";
import GhostTextarea from "../components/GhostTextarea";
import { getListingDescriptionSuggestion } from "../utils/suggestions";

interface ListingFormValues {
  itemId: string;
  itemName: string;
  title: string;
  description: string;
  qty: string;
  unit: string;
  price: string;
  availability: {
    startAt: string;
    endAt: string;
  };
  fulfillment: string;
  zipCode: string;
  photos: Array<{ imageId: string }>;
  attributes?: Record<string, unknown> | null;
}

const INITIAL_FORM: ListingFormValues = {
  itemId: "",
  itemName: "",
  title: "",
  description: "",
  qty: "",
  unit: "",
  price: "",
  availability: {
    startAt: "",
    endAt: "",
  },
  fulfillment: "",
  zipCode: "",
  photos: [],
  attributes: undefined,
};

const DEFAULT_UNIT_OPTIONS = ["kg", "lb", "count", "bunch"];

function toTitleCase(value: string): string {
  return value.replace(/\w\S*/g, (word) => {
    const first = word.charAt(0).toLocaleUpperCase();
    return `${first}${word.slice(1)}`;
  });
}

export default function NewListing() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { uploadImage, getDraft, createListing } = useListingActions();
  const [form, setForm] = useState<ListingFormValues>(INITIAL_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [draft, setDraft] = useState<DraftFromImageResponse | null>(null);
  const imageId = form.photos[0]?.imageId ?? "";

  const canGenerateDraft = Boolean(imageId) && !generatingDraft;

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function updateField(field: keyof ListingFormValues, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError(null);
  }

  function preventWheelStepChange(
    e: React.WheelEvent<HTMLInputElement>
  ) {
    e.currentTarget.blur();
  }

  function validateForm(values: ListingFormValues): string | null {
    if (!values.itemName.trim()) return "Item name is required";
    if (!values.title.trim()) return "Title is required";
    if (!values.description.trim()) return "Description is required";
    if (!values.qty.trim()) return "Quantity is required";
    if (!values.unit.trim()) return "Unit is required";
    if (!values.price.trim()) return "Price is required";
    if (!values.zipCode.trim()) return "Postal code is required";
    if (!values.photos[0]?.imageId) return "Photo upload is required";

    const qtyNum = Number(values.qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      return "Quantity must be greater than 0";
    }

    const priceNum = Number(values.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return "Price must be 0 or greater";
    }

    return null;
  }

  // Memoised so GhostTextarea's debounce effect only re-fires when relevant
  // form fields change, not on every render.
  const getDescriptionSuggestion = useCallback(
    (text: string) =>
      getListingDescriptionSuggestion(text, {
        itemName: form.itemName,
        qty: form.qty,
        unit: form.unit,
        price: form.price,
        priceUnit: form.unit,
      }),
    [form.itemName, form.qty, form.unit, form.price]
  );

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setToast(null);
    setError(null);
    setSelectedImage(file);
    setDraft(null);

    const nextPreview = URL.createObjectURL(file);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return nextPreview;
    });

    setUploadingImage(true);
    try {
      const upload = await uploadImage(file);
      setForm((prev) => ({
        ...prev,
        photos: [{ imageId: upload.imageId }],
      }));
    } catch (err: unknown) {
      setForm((prev) => ({ ...prev, photos: [] }));
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
      setError(err instanceof Error ? err.message : "Failed to upload image");
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleGenerateDraft() {
    if (!imageId) return;
    setGeneratingDraft(true);
    setError(null);
    setToast(null);
    try {
      const result = await getDraft(imageId);
      setDraft(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to generate draft");
    } finally {
      setGeneratingDraft(false);
    }
  }

  function applyDraftSafeOnly(suggestedFields: DraftSuggestedFields) {
    const suggestedItemName = suggestedFields.itemName?.trim() || "";
    const suggestedUnit = suggestedFields.unit?.trim() || "";
    setForm((prev) => ({
      ...prev,
      itemId: suggestedFields.itemId || prev.itemId,
      itemName: suggestedItemName || prev.itemName,
      title:
        suggestedFields.title ??
        (suggestedItemName
          ? `Fresh ${toTitleCase(suggestedItemName)}`
          : "Fresh local produce"),
      description: suggestedFields.description || prev.description,
      price:
        typeof suggestedFields.price === "number" &&
        Number.isFinite(suggestedFields.price)
          ? suggestedFields.price.toFixed(2)
          : prev.price,
      unit: suggestedUnit || prev.unit,
      attributes:
        suggestedFields.attributes !== undefined
          ? suggestedFields.attributes
          : prev.attributes,
    }));
    setDraft(null);
  }

  const requiredMissing = useMemo(() => Boolean(validateForm(form)), [form]);
  const unitOptions = useMemo(() => {
    const fromDraft = draft?.suggestedFields.unitOptions || [];
    const all = [...fromDraft, ...DEFAULT_UNIT_OPTIONS];
    return Array.from(new Set(all.filter(Boolean)));
  }, [draft?.suggestedFields.unitOptions]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const validationMessage = validateForm(form);
      if (validationMessage) throw new Error(validationMessage);

      const price = Number(form.price);
      const qty = Number(form.qty);
      const latLng = await geocodeZipCode(form.zipCode);

      const type = user?.role === "farmer" ? "supply" : "demand";

      // Current backend create payload still expects item + latLng.
      // We map from the richer form model without auto-filling unsafe fields.
      await createListing({
        type,
        title: form.title.trim(),
        item: form.itemName.trim(),
        description: form.description.trim(),
        price,
        qty,
        unit: (form.unit || "kg") as "kg" | "lb" | "count" | "bunch",
        latLng,
        photos: form.photos,
      });

      navigate("/listings");
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-8">
      <h1 className="text-2xl font-semibold text-zinc-900 mb-6">
        Create supply listing
      </h1>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}
      {toast && (
        <div className="mb-4 p-3 bg-harvest-50 border border-harvest-200 text-harvest-800 rounded-lg text-sm">
          {toast}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-earth-700 mb-1">
            Upload produce photo <span className="text-red-500">*</span>
          </label>
          <label
            className={`flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed cursor-pointer transition-colors
              ${uploadingImage
                ? "border-leaf-300 bg-leaf-50"
                : imageId
                  ? "border-leaf-400 bg-leaf-50"
                  : "border-earth-300 bg-earth-50 hover:border-leaf-400 hover:bg-leaf-50"
              }`}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Selected produce preview"
                className="w-full h-48 object-cover rounded-xl"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 px-4 text-center select-none">
                <svg
                  className="w-10 h-10 text-earth-400"
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
                <span className="text-sm font-medium text-earth-700">
                  Click to choose a file
                </span>
                <span className="text-xs text-earth-400">JPEG, PNG, WEBP</span>
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
            <p className={`text-xs mt-1.5 ${uploadingImage ? "text-leaf-600 font-medium" : "text-earth-500"}`}>
              {uploadingImage ? "⏳ Uploading…" : `✓ ${selectedImage.name}`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!canGenerateDraft}
            onClick={handleGenerateDraft}
            className="btn-secondary disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {generatingDraft ? "Generating..." : "Generate draft"}
          </button>
          <span className="text-xs text-earth-500">
            AI only suggests item/title/description/attributes.
          </span>
        </div>

        {draft && (
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-earth-900">AI draft suggestion</h2>
              <span className="text-sm text-earth-600">
                Confidence: {Math.round((draft.confidence || 0) * 100)}%
              </span>
            </div>

            <div className="text-sm text-earth-700 space-y-1">
              <p>
                <span className="font-medium">Item:</span>{" "}
                {draft.suggestedFields.itemName || "None"}
              </p>
              <p>
                <span className="font-medium">Title:</span>{" "}
                {draft.suggestedFields.title || "None"}
              </p>
              <p>
                <span className="font-medium">Description:</span>{" "}
                {draft.suggestedFields.description}
              </p>
              {typeof draft.suggestedFields.price === "number" && (
                <p>
                  <span className="font-medium">Suggested price:</span>{" "}
                  ${draft.suggestedFields.price.toFixed(2)}
                  {draft.suggestedFields.unit
                    ? ` per ${draft.suggestedFields.unit}`
                    : ""}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-primary"
                onClick={() => applyDraftSafeOnly(draft.suggestedFields)}
              >
                Apply
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDraft(null)}
              >
                Dismiss
              </button>
            </div>
            {/* <p className="text-xs text-earth-500">
              Not automatically filled: {NEVER_AUTO_FILL.join(", ")}
            </p> */}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-earth-700 mb-1">
            Item name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.itemName}
            onChange={(e) => updateField("itemName", e.target.value)}
            placeholder="e.g. Tomatoes"
            className="input-field"
            maxLength={100}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-earth-700 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => updateField("title", e.target.value)}
            placeholder="e.g. Fresh Tomatoes"
            className="input-field"
            maxLength={150}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-earth-700 mb-1">
            Description <span className="text-red-500">*</span>
          </label>
          <GhostTextarea
            value={form.description}
            onChange={(v) => updateField("description", v)}
            getSuggestion={getDescriptionSuggestion}
            placeholder="Describe what you're offering or looking for — variety, quality, etc."
            rows={3}
            maxLength={2000}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-earth-700 mb-1">
            Quantity <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            value={form.qty}
            onChange={(e) => updateField("qty", e.target.value)}
            onWheel={preventWheelStepChange}
            placeholder="e.g. 50"
            min="1"
            step="1"
            className="input-field"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-earth-700 mb-1">
            Unit <span className="text-red-500">*</span>
          </label>
          <select
            value={form.unit}
            onChange={(e) => updateField("unit", e.target.value)}
            className="input-field"
          >
            <option value="">Select a unit</option>
            {unitOptions.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-earth-700 mb-1">
            Price{form.unit ? ` per ${form.unit}` : ""} <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            value={form.price}
            onChange={(e) => updateField("price", e.target.value)}
            onWheel={preventWheelStepChange}
            placeholder="0.00"
            min="0"
            step="0.01"
            className="input-field"
          />
        </div>

        {/* <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-earth-700 mb-1">
              Available from <span className="text-red-500">*</span>
            </label>
            <input
              type="datetime-local"
              value={form.availability.startAt}
              onChange={(e) => updateAvailability("startAt", e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-earth-700 mb-1">
              Available until <span className="text-red-500">*</span>
            </label>
            <input
              type="datetime-local"
              value={form.availability.endAt}
              onChange={(e) => updateAvailability("endAt", e.target.value)}
              className="input-field"
            />
          </div>
        </div> */}

        {/* <div>
          <label className="block text-sm font-medium text-earth-700 mb-1">
            Fulfillment <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.fulfillment}
            onChange={(e) => updateField("fulfillment", e.target.value)}
            placeholder="e.g. pickup only"
            className="input-field"
          />
        </div> */}

        <div>
          <label className="block text-sm font-medium text-earth-700 mb-1">
            Postal code <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.zipCode}
            onChange={(e) => updateField("zipCode", e.target.value)}
            placeholder="e.g. K1A 0B1"
            className="input-field"
            maxLength={10}
          />
          <p className="text-earth-500 text-xs mt-1">
            Enter a Canadian postal code. We geocode this to listing coordinates.
          </p>
        </div>

        <button
          type="submit"
          disabled={submitting || requiredMissing}
          className="w-full py-3 px-4 rounded-lg font-medium bg-leaf-600 text-white hover:bg-leaf-700 disabled:bg-earth-300 disabled:text-earth-500 transition-colors"
        >
          {submitting ? "Creating..." : "Create listing"}
        </button>
      </form>
    </div>
  );
}
