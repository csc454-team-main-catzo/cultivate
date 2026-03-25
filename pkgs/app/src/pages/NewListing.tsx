import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUser } from "../providers/userContext";
import {
  ApiStatusError,
  type DraftFromImageResponse,
  type DraftSuggestedFields,
  type GuardRejection,
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
  const [guardRejection, setGuardRejection] = useState<GuardRejection | null>(null);
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
    setGuardRejection(null);

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
    setGuardRejection(null);
    try {
      const result = await getDraft(imageId);
      setDraft(result);
    } catch (err: unknown) {
      if (
        err instanceof ApiStatusError &&
        err.status === 422 &&
        (err as ApiStatusError & { guardRejection?: GuardRejection }).guardRejection
      ) {
        setGuardRejection(
          (err as ApiStatusError & { guardRejection: GuardRejection }).guardRejection
        );
      } else {
        setError(err instanceof Error ? err.message : "Failed to generate draft");
      }
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

      if (!user?.postalCode?.trim()) {
        throw new Error(
          "Add a Canadian postal code in your profile before creating a listing."
        );
      }

      const price = Number(form.price);
      const qty = Number(form.qty);

      const type = user?.role === "farmer" ? "supply" : "demand";

      await createListing({
        type,
        title: form.title.trim(),
        item: form.itemName.trim(),
        description: form.description.trim(),
        price,
        qty,
        unit: (form.unit || "kg") as "kg" | "lb" | "count" | "bunch",
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
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm space-y-2">
          <p>{error}</p>
          {error.includes("postal code") && (
            <p>
              <Link to="/profile" className="font-medium underline text-red-800">
                Open profile
              </Link>{" "}
              to set your postal code.
            </p>
          )}
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
            Upload produce photo <span className="text-red-500">*</span>
          </label>
          <label
            className={`flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed cursor-pointer transition-colors
              ${uploadingImage
                ? "border-leaf-300 bg-leaf-50"
                : imageId
                  ? "border-leaf-400 bg-leaf-50"
                  : "border-zinc-300 bg-zinc-50 hover:border-leaf-400 hover:bg-leaf-50"
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
                  Click to choose a file
                </span>
                <span className="text-xs text-zinc-400">JPEG, PNG, WEBP</span>
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
            <p className={`text-xs mt-1.5 ${uploadingImage ? "text-leaf-600 font-medium" : "text-zinc-500"}`}>
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
          <span className="text-xs text-zinc-500">
            AI only suggests item/title/description/attributes.
          </span>
        </div>

        {guardRejection && (
          <div className="card p-4 space-y-3 border-amber-200 bg-amber-50">
            <h2 className="text-lg font-semibold text-amber-900">
              {guardRejection.error === "not_produce"
                ? "Image not recognized as produce"
                : "Could not identify produce"}
            </h2>
            <p className="text-sm text-amber-800">{guardRejection.feedback}</p>
            {guardRejection.exampleImageHint && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-white p-3">
                <div className="shrink-0 flex items-center justify-center w-16 h-16 rounded-lg bg-leaf-50 border border-leaf-200">
                  <svg className="w-8 h-8 text-leaf-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.115 5.19l.319 1.913A6 6 0 008.11 10.36L9.75 12l-.387.775c-.217.433-.132.956.21 1.298l1.348 1.348c.21.21.329.497.329.795v1.089c0 .426.24.815.622 1.006l.153.076c.433.217.956.132 1.298-.21l.723-.723a8.7 8.7 0 002.288-4.042 1.087 1.087 0 00-.358-1.099l-1.33-1.108c-.251-.21-.582-.299-.905-.245l-1.17.195a1.125 1.125 0 01-.98-.314l-.295-.295a1.125 1.125 0 010-1.591l.13-.132a1.125 1.125 0 011.3-.21l.603.302a.809.809 0 001.086-1.086L14.25 7.5l1.256-.837a4.5 4.5 0 001.528-1.732l.146-.292M6.115 5.19A9 9 0 1017.18 4.64M6.115 5.19A8.965 8.965 0 0112 3c1.929 0 3.72.607 5.18 1.64" />
                  </svg>
                </div>
                <div className="text-xs text-zinc-600">
                  <p className="font-medium text-zinc-800 mb-1">Tip for a good photo</p>
                  <p>{guardRejection.exampleImageHint}</p>
                </div>
              </div>
            )}
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => setGuardRejection(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {draft && (
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-zinc-900">AI draft suggestion</h2>
              <span className="text-sm text-zinc-600">
                Confidence: {Math.round((draft.confidence || 0) * 100)}%
              </span>
            </div>

            <div className="text-sm text-zinc-700 space-y-1">
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
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">
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
          <label className="block text-sm font-medium text-zinc-700 mb-1">
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
          <label className="block text-sm font-medium text-zinc-700 mb-1">
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
          <label className="block text-sm font-medium text-zinc-700 mb-1">
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
          <label className="block text-sm font-medium text-zinc-700 mb-1">
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
          <label className="block text-sm font-medium text-zinc-700 mb-1">
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

        <p className="text-sm text-zinc-600">
          Listing location uses the postal code in your{" "}
          <Link to="/profile" className="text-leaf-700 font-medium hover:underline">
            profile
          </Link>
          .
        </p>

        <button
          type="submit"
          disabled={submitting || requiredMissing}
          className="w-full py-3 px-4 rounded-lg font-medium bg-leaf-600 text-white hover:bg-leaf-700 disabled:bg-zinc-300 disabled:text-zinc-500 transition-colors"
        >
          {submitting ? "Creating..." : "Create listing"}
        </button>
      </form>
    </div>
  );
}
