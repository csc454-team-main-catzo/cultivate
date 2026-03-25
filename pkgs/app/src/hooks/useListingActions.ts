import { useCallback } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import CFG from "../config";

export interface UpdateListingBody {
  title?: string;
  item?: string;
  description?: string;
  price?: number;
  qty?: number;
  unit?: "kg" | "lb" | "count" | "bunch";
  status?: string;
  photos?: Array<{ imageId: string }>;
}

export interface CreateListingBody {
  type: "demand" | "supply";
  title: string;
  item: string;
  description: string;
  price: number;
  qty: number;
  unit?: "kg" | "lb" | "count" | "bunch";
  photos?: Array<{ imageId: string }>;
}

export interface UploadImageResponse {
  imageId: string;
  filename?: string;
  mimeType?: string;
  size?: number;
}

export interface ParsedSheetLineItem {
  item: string;
  qtyNeeded: number;
  unit: "kg" | "lb" | "count" | "bunch";
  maxPricePerUnit?: number;
  acceptSubstitutes?: boolean;
  notes?: string;
}

export interface ParseSourcingSheetResponse {
  filename: string;
  sheet: string;
  parsedCount: number;
  lineItems: ParsedSheetLineItem[];
  sourceRows: number[];
}

export interface DraftReason {
  desc: string;
  score: number;
  topicality?: number;
}

export interface DraftSuggestedFields {
  itemId: string | null;
  itemName: string | null;
  title: string | null;
  description: string;
  price?: number | null;
  unit?: string | null;
  priceUnit?: string | null;
  unitOptions?: string[];
  priceUnitOptions?: string[];
  quality: null;
  attributes?: Record<string, unknown> | null;
}

export interface DraftFromImageResponse {
  draftSuggestionId: string;
  imageId: string;
  suggestedFields: DraftSuggestedFields;
  confidence: number;
  reasons: DraftReason[];
}

export class ApiStatusError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function useListingActions() {
  const { getAccessTokenSilently } = useAuth0();

  const getAuthHeaders = useCallback(async () => {
    const token = await getAccessTokenSilently({
      authorizationParams: { audience: import.meta.env.VITE_AUTH0_AUDIENCE },
    });
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }, [getAccessTokenSilently]);

  const updateListing = useCallback(
    async (id: string, body: UpdateListingBody) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`${CFG.API_URL}/listings/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to update listing");
      }
      return res.json();
    },
    [getAuthHeaders]
  );

  const createListing = useCallback(
    async (body: CreateListingBody) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`${CFG.API_URL}/api/listings`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string | { message?: string } };
      if (!res.ok) {
        const err = data?.error;
        const message =
          typeof err === "string"
            ? err
            : err && typeof err === "object" && typeof (err as { message?: string }).message === "string"
              ? (err as { message: string }).message
              : "Failed to create listing";
        throw new Error(message);
      }
      return data;
    },
    [getAuthHeaders]
  );

  const deleteListing = useCallback(
    async (id: string) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`${CFG.API_URL}/listings/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to delete listing");
      }
    },
    [getAuthHeaders]
  );

  const matchListingResponse = useCallback(
    async (listingId: string, responseId: string) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`${CFG.API_URL}/listings/${listingId}/match`, {
        method: "POST",
        headers,
        body: JSON.stringify({ responseId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to match response");
      }
      return res.json();
    },
    [getAuthHeaders]
  );

  const deleteListingResponse = useCallback(
    async (listingId: string, responseId: string) => {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${CFG.API_URL}/listings/${listingId}/responses/${responseId}`,
        {
          method: "DELETE",
          headers,
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error || "Failed to delete response"
        );
      }
      return res.json();
    },
    [getAuthHeaders]
  );

  const uploadImage = useCallback(
    async (file: File): Promise<UploadImageResponse> => {
      const token = await getAccessTokenSilently({
        authorizationParams: { audience: import.meta.env.VITE_AUTH0_AUDIENCE },
      });
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch(`${CFG.API_URL}/api/images/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        imageId?: string;
        filename?: string;
        mimeType?: string;
        size?: number;
      };

      if (!res.ok) {
        throw new ApiStatusError(
          res.status,
          data.error || "Failed to upload image"
        );
      }

      if (!data.imageId) {
        throw new Error("Upload response missing imageId");
      }

      return {
        imageId: data.imageId,
        filename: data.filename,
        mimeType: data.mimeType,
        size: data.size,
      };
    },
    [getAccessTokenSilently]
  );

  const getDraft = useCallback(
    async (imageId: string): Promise<DraftFromImageResponse> => {
      const headers = await getAuthHeaders();
      const res = await fetch(`${CFG.API_URL}/api/listings/draft-from-image`, {
        method: "POST",
        headers,
        body: JSON.stringify({ imageId }),
      });
      const data = (await res.json().catch(() => ({}))) as DraftFromImageResponse & {
        error?: string;
      };
      if (!res.ok) {
        throw new ApiStatusError(
          res.status,
          data.error || "Failed to generate draft"
        );
      }
      return data;
    },
    [getAuthHeaders]
  );

  const parseSourcingSheet = useCallback(
    async (file: File): Promise<ParseSourcingSheetResponse> => {
      const token = await getAccessTokenSilently({
        authorizationParams: { audience: import.meta.env.VITE_AUTH0_AUDIENCE },
      });
      const formData = new FormData();
      formData.append("sheet", file);

      const res = await fetch(`${CFG.API_URL}/api/sourcing/parse-sheet`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = (await res.json().catch(() => ({}))) as ParseSourcingSheetResponse & {
        error?: string;
      };

      if (!res.ok) {
        throw new ApiStatusError(
          res.status,
          data.error || "Failed to parse sourcing sheet"
        );
      }

      if (!Array.isArray(data.lineItems)) {
        throw new Error("Parse response missing lineItems");
      }

      return data;
    },
    [getAccessTokenSilently]
  );

  const runOptimizer = useCallback(
    async (lineItems: ParsedSheetLineItem[]) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`${CFG.API_URL}/api/sourcing/optimize`, {
        method: "POST",
        headers,
        body: JSON.stringify({ lineItems }),
      });

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
        error?: string;
      };

      if (!res.ok) {
        throw new ApiStatusError(
          res.status,
          data.error || "Optimization failed"
        );
      }

      return data;
    },
    [getAuthHeaders]
  );

  return {
    createListing,
    updateListing,
    deleteListing,
    matchListingResponse,
    deleteListingResponse,
    uploadImage,
    parseSourcingSheet,
    runOptimizer,
    getDraft,
  };
}
