import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import { authMiddleware } from "../middleware/auth.js";
import type { AuthenticatedContext } from "../middleware/types.js";
import DraftSuggestion from "../models/DraftSuggestion.js";
import ImageAsset from "../models/ImageAsset.js";
import Listing, { type IResponse } from "../models/Listing.js";
import { User } from "../models/User.js";
import ChatThread, { type IChatThread } from "../models/ChatThread.js";
import CFG from "../config.js";
import { downloadBufferFromGridFS } from "../services/gridfs.js";
import { matchProduceFromTags, toTitleCase } from "../services/produceMatcher.js";
import { getTags, type AzureVisionTag } from "../services/visionAzure.js";
import { logJson } from "../utils/log.js";
import {
  DraftFromImageResponseSchema,
  DraftFromImageSchema,
  type DraftFromImageInput,
} from "../schemas/draft-suggestion.js";
import {
  ListingCreateSchema,
  type ListingCreateInput,
  ListingUpdateSchema,
  type ListingUpdateInput,
  MatchRequestSchema,
  type MatchRequestInput,
  ResponseCreateSchema,
  type ResponseCreateInput,
  ListingListResponseSchema,
  ListingResponseSchema,
} from "../schemas/listing.js";

const listings = new Hono<AuthenticatedContext>();
const itemMatchThreshold = Number(CFG.ITEM_MATCH_THRESHOLD || 0.6);
const NEVER_AUTO_FILL = [
  "qty",
  // unit is now suggested from taxonomy metadata
  // price is now suggested from taxonomy metadata
  // priceUnit is now suggested from taxonomy metadata
  "availability",
  "fulfillment",
  "location",
];
listings.use(describeRoute({
  tags: ['Listings']
}))

/* ------------------------------------------------------------------ */
/*  GET /listings — public, list all listings, optional ?type= filter  */
/* ------------------------------------------------------------------ */
listings.get(
  "/",
  describeRoute({
    operationId: "listListings",
    summary:
      "List all listings. Optional ?type=demand|supply filter. Returns creator info populated.",
    responses: {
      200: {
        description: "Array of listings",
        content: {
          "application/json": {
            schema: resolver(ListingListResponseSchema),
          },
        },
      },
      500: { description: "Server error" },
    },
  }),
  async (c) => {
    try {
      const typeFilter = c.req.query("type");
      const filter: Record<string, string> = {};
      if (typeFilter === "demand" || typeFilter === "supply") {
        filter.type = typeFilter;
      }

      const all = await Listing.find(filter)
        .populate("createdBy", "name email role")
        .populate("responses.createdBy", "name email role")
        .sort({ createdAt: -1 });

      // .toJSON() respects schema defaults, so null fields appear
      return c.json(all.map((doc) => doc.toJSON()), 200);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);

/* ------------------------------------------------------------------ */
/*  GET /listings/:id — public, single listing with embedded responses */
/* ------------------------------------------------------------------ */
listings.get(
  "/:id",
  describeRoute({
    operationId: "getListing",
    summary: "Get a single listing with its embedded responses",
    responses: {
      200: {
        description: "Listing with embedded responses",
        content: {
          "application/json": {
            schema: resolver(ListingResponseSchema),
          },
        },
      },
      404: { description: "Listing not found" },
    },
  }),
  async (c) => {
    try {
      const listing = await Listing.findById(c.req.param("id"))
        .populate("createdBy", "name email role")
        .populate("responses.createdBy", "name email role");

      if (!listing) {
        return c.json({ error: "Listing not found" }, 404);
      }

      return c.json(listing.toJSON(), 200);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);

/* ------------------------------------------------------------------ */
/*  POST /listings — auth required, create a demand or supply listing  */
/* ------------------------------------------------------------------ */
listings.post(
  "/",
  describeRoute({
    operationId: "createListing",
    summary: "Create a new listing (demand or supply)",
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: "Listing created successfully",
        content: {
          "application/json": {
            schema: resolver(ListingResponseSchema),
          },
        },
      },
      400: { description: "Validation error" },
      401: { description: "Unauthorized" },
    },
  }),
  authMiddleware(),
  validator("json", ListingCreateSchema),
  async (c) => {
    try {
      // WORKAROUND: hono-openapi's validator registers types differently than
      // Hono's built-in validator, causing a type mismatch on c.req.valid().
      // The `as never` cast silences TS; runtime validation is handled by the
      // validator("json", ListingCreateSchema) middleware above.
      const data = c.req.valid("json" as never) as ListingCreateInput;
      const userId = c.get("userId");

      const user = await User.findById(userId);
      if (!user?.postalCode || !user.latLng || user.latLng.length !== 2) {
        return c.json(
          {
            error:
              "Add a Canadian postal code in your profile before creating a listing.",
          },
          400
        );
      }

      const listing = await Listing.create({
        ...data,
        latLng: user.latLng as [number, number],
        postalCode: user.postalCode,
        createdBy: userId,
      });

      const populated = await Listing.findById(listing._id)
        .populate("createdBy", "name email role")
        .lean();

      return c.json(populated, 201);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "ValidationError") {
        return c.json({ error: err.message }, 400);
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);

listings.post(
  "/draft-from-image",
  describeRoute({
    operationId: "createDraftFromImage",
    summary: "Generate listing draft suggestion from an uploaded image",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: "Created draft suggestion from image",
        content: {
          "application/json": {
            schema: resolver(DraftFromImageResponseSchema),
          },
        },
      },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden" },
      404: { description: "Image not found" },
    },
  }),
  authMiddleware(),
  validator("json", DraftFromImageSchema),
  async (c) => {
    try {
      const { imageId } = c.req.valid("json" as never) as DraftFromImageInput;
      const userId = c.get("userId");

      const imageAsset = await ImageAsset.findById(imageId);
      if (!imageAsset) {
        return c.json({ error: "Image asset not found" }, 404);
      }

      if (imageAsset.owner.toString() !== userId) {
        return c.json({ error: "You do not own this image asset" }, 403);
      }

      const imageBuffer = await downloadBufferFromGridFS(
        imageAsset.gridFsFileId.toString()
      );

      let tags: AzureVisionTag[] = [];
      try {
        tags = await getTags(imageBuffer);
      } catch {
        return c.json({ error: "vision_failed" }, 500);
      }

      const reasons = tags.slice(0, 5).map((tag) => ({
        desc: tag.name,
        score: tag.confidence,
      }));

      const match = await matchProduceFromTags(tags, itemMatchThreshold);
      const itemName = match.itemName;
      const suggestedUnit = match.selected?.defaultUnit || null;
      const suggestedPriceHint = match.selected?.priceHints?.[0];
      const suggestedPrice =
        suggestedPriceHint && Number.isFinite(suggestedPriceHint.suggested)
          ? suggestedPriceHint.suggested
          : null;
      const unitOptions =
        match.selected?.commonUnits?.length
          ? match.selected.commonUnits
          : suggestedUnit
            ? [suggestedUnit]
            : [];
      const title = itemName ? `Fresh ${toTitleCase(itemName)}` : "Fresh local produce";
      const description = itemName
        ? `Fresh ${toTitleCase(itemName)}, locally grown. Message for pickup window + partial fulfillment.`
        : "Fresh local produce. Message for pickup window + partial fulfillment.";
      const suggestedFields = {
        itemId: match.itemId,
        itemName: match.itemName,
        title,
        description,
        price: suggestedPrice,
        unit: suggestedUnit,
        priceUnit: suggestedUnit,
        unitOptions,
        priceUnitOptions: unitOptions,
        quality: null as null,
      };

      const draftSuggestion = await DraftSuggestion.create({
        imageId,
        ownerId: userId,
        suggestedFields,
        confidences: {
          item: match.confidence,
          labels: reasons,
        },
        provider: "azure",
      });

      logJson("vision_draft_request", {
        userId,
        imageId,
        draftSuggestionId: draftSuggestion._id.toString(),
        sharp: {
          outMimeType: imageAsset.mimeType,
          width: imageAsset.width ?? null,
          height: imageAsset.height ?? null,
          sizeBytes: imageAsset.size,
        },
        azure: {
          tagsTop20: tags.slice(0, 20),
        },
        match: {
          threshold: match.threshold,
          topCandidates: match.topCandidates.slice(0, 5),
          selected: match.selected,
        },
      });

      return c.json(
        {
          draftSuggestionId: draftSuggestion._id.toString(),
          imageId,
          suggestedFields,
          confidence: match.confidence,
          reasons,
          safeFieldPolicy: {
            neverAutoFill: NEVER_AUTO_FILL,
            populated: [
              "itemId",
              "itemName",
              "title",
              "description",
              "price",
              "unit",
              "priceUnit",
              "quality",
            ],
          },
        },
        200
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);

/* ------------------------------------------------------------------ */
/*  POST /listings/:id/responses — auth required, add an offer        */
/* ------------------------------------------------------------------ */
listings.post(
  "/:id/responses",
  describeRoute({
    operationId: "createListingResponse",
    summary:
      "Add a response (farmer offer) to an existing demand listing",
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: "Response added, returns updated listing",
        content: {
          "application/json": {
            schema: resolver(ListingResponseSchema),
          },
        },
      },
      400: { description: "Validation error" },
      401: { description: "Unauthorized" },
      404: { description: "Listing not found" },
    },
  }),
  authMiddleware(),
  validator("json", ResponseCreateSchema),
  async (c) => {
    try {
      const listingId = c.req.param("id");
      // WORKAROUND: same hono-openapi type mismatch — see note in POST /listings
      const data = c.req.valid("json" as never) as ResponseCreateInput;
      const userId = c.get("userId");

      const listing = await Listing.findById(listingId);

      if (!listing) {
        return c.json({ error: "Listing not found" }, 404);
      }

      if (listing.status !== "open") {
        return c.json(
          { error: "Cannot add responses to a non-open listing" },
          400
        );
      }

      listing.responses.push({
        ...data,
        createdBy: userId,
      } as any);

      await listing.save();

      // Ensure a chat thread exists between the listing owner and responder
      const latestResponse = listing.responses[listing.responses.length - 1];
      if (latestResponse) {
        const participantIds = [
          listing.createdBy.toString(),
          latestResponse.createdBy.toString(),
        ].sort();

        const existingThread = await ChatThread.findOne({
          listing: listing._id,
          response: latestResponse._id,
        });

        if (!existingThread) {
          await ChatThread.create({
            listing: listing._id,
            response: latestResponse._id,
            participants: participantIds,
          } as Partial<IChatThread>);
        }
      }

      const populated = await Listing.findById(listing._id)
        .populate("createdBy", "name email role")
        .populate("responses.createdBy", "name email role")
        .lean();

      return c.json(populated, 201);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "ValidationError") {
        return c.json({ error: err.message }, 400);
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);

/* ------------------------------------------------------------------ */
/*  DELETE /listings/:id/responses/:responseId — delete own response  */
/* ------------------------------------------------------------------ */
listings.delete(
  "/:id/responses/:responseId",
  describeRoute({
    operationId: "deleteListingResponse",
    summary: "Delete a response from a listing (response owner only)",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: "Response deleted, returns updated listing",
        content: {
          "application/json": {
            schema: resolver(ListingResponseSchema),
          },
        },
      },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden — not the response owner" },
      404: { description: "Listing or response not found" },
    },
  }),
  authMiddleware(),
  async (c) => {
    try {
      const listingId = c.req.param("id");
      const responseId = c.req.param("responseId");
      const userId = c.get("userId");

      const listing = await Listing.findById(listingId);

      if (!listing) {
        return c.json({ error: "Listing not found" }, 404);
      }

      const response = listing.responses.id(responseId) as IResponse | null;

      if (!response) {
        return c.json({ error: "Response not found" }, 404);
      }

      if (response.createdBy.toString() !== userId) {
        return c.json(
          { error: "You can only delete your own response" },
          403
        );
      }

      // If the deleted response was matched, reset the match
      if (
        listing.matchedResponseId &&
        listing.matchedResponseId.toString() === responseId
      ) {
        listing.matchedResponseId = null as any;
        if (listing.status === "matched") {
          listing.status = "open";
        }
      }

      // Remove the response subdocument
      listing.responses = listing.responses.filter(
        (r: IResponse) => r._id.toString() !== responseId
      ) as any;
      await listing.save();

      const populated = await Listing.findById(listing._id)
        .populate("createdBy", "name email role")
        .populate("responses.createdBy", "name email role")
        .lean();

      return c.json(populated, 200);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);

/* ------------------------------------------------------------------ */
/*  POST /listings/:id/match — auth required, owner matches a response */
/* ------------------------------------------------------------------ */
listings.post(
  "/:id/match",
  describeRoute({
    operationId: "matchListingResponse",
    summary: "Match with a response (owner only). Sets listing status to matched.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: "Listing updated with matched response",
        content: {
          "application/json": {
            schema: resolver(ListingResponseSchema),
          },
        },
      },
      400: { description: "Listing not open or invalid response" },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden — not the listing owner" },
      404: { description: "Listing not found" },
    },
  }),
  authMiddleware(),
  validator("json", MatchRequestSchema),
  async (c) => {
    try {
      const listingId = c.req.param("id");
      const { responseId } = c.req.valid("json" as never) as MatchRequestInput;
      const userId = c.get("userId");

      const listing = await Listing.findById(listingId);
      if (!listing) {
        return c.json({ error: "Listing not found" }, 404);
      }
      if (listing.createdBy.toString() !== userId) {
        return c.json({ error: "Only the listing owner can match a response" }, 403);
      }
      if (listing.status !== "open") {
        return c.json(
          { error: "Can only match a response when the listing is open" },
          400
        );
      }

      const responseExists = listing.responses.some(
        (r: IResponse) => r._id.toString() === responseId
      );
      if (!responseExists) {
        return c.json({ error: "Response not found for this listing" }, 400);
      }

      listing.matchedResponseId = responseId as any;
      listing.status = "matched";
      await listing.save();

      const populated = await Listing.findById(listing._id)
        .populate("createdBy", "name email role")
        .populate("responses.createdBy", "name email role")
        .lean();

      return c.json(populated, 200);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "ValidationError") {
        return c.json({ error: err.message }, 400);
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);

/* ------------------------------------------------------------------ */
/*  PATCH /listings/:id — auth required, update own listing           */
/* ------------------------------------------------------------------ */
listings.patch(
  "/:id",
  describeRoute({
    operationId: "updateListing",
    summary: "Update a listing (owner only)",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: "Listing updated",
        content: {
          "application/json": {
            schema: resolver(ListingResponseSchema),
          },
        },
      },
      400: { description: "Validation error" },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden — not the listing owner" },
      404: { description: "Listing not found" },
    },
  }),
  authMiddleware(),
  validator("json", ListingUpdateSchema),
  async (c) => {
    try {
      const listingId = c.req.param("id");
      const data = c.req.valid("json" as never) as ListingUpdateInput;
      const userId = c.get("userId");

      const listing = await Listing.findById(listingId);
      if (!listing) {
        return c.json({ error: "Listing not found" }, 404);
      }
      if (listing.createdBy.toString() !== userId) {
        return c.json({ error: "You can only edit your own listing" }, 403);
      }

      if (data.photos !== undefined) {
        for (const p of data.photos) {
          const imageAsset = await ImageAsset.findById(p.imageId);
          if (!imageAsset) {
            return c.json({ error: "Image asset not found" }, 400);
          }
          if (imageAsset.owner.toString() !== userId) {
            return c.json(
              { error: "You can only attach images you uploaded" },
              403
            );
          }
        }
        listing.photos = data.photos;
      }

      if (data.title !== undefined) listing.title = data.title;
      if (data.item !== undefined) listing.item = data.item;
      if (data.description !== undefined) listing.description = data.description;
      if (data.price !== undefined) listing.price = data.price;
      if (data.qty !== undefined) listing.qty = data.qty;
      if (data.status !== undefined) listing.status = data.status;
      await listing.save();

      const populated = await Listing.findById(listing._id)
        .populate("createdBy", "name email role")
        .populate("responses.createdBy", "name email role")
        .lean();

      return c.json(populated, 200);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "ValidationError") {
        return c.json({ error: err.message }, 400);
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);

/* ------------------------------------------------------------------ */
/*  DELETE /listings/:id — auth required, delete own listing          */
/* ------------------------------------------------------------------ */
listings.delete(
  "/:id",
  describeRoute({
    operationId: "deleteListing",
    summary: "Delete a listing (owner only)",
    security: [{ bearerAuth: [] }],
    responses: {
      204: { description: "Listing deleted" },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden — not the listing owner" },
      404: { description: "Listing not found" },
    },
  }),
  authMiddleware(),
  async (c) => {
    try {
      const listingId = c.req.param("id");
      const userId = c.get("userId");

      const listing = await Listing.findById(listingId);
      if (!listing) {
        return c.json({ error: "Listing not found" }, 404);
      }
      if (listing.createdBy.toString() !== userId) {
        return c.json({ error: "You can only delete your own listing" }, 403);
      }

      await Listing.findByIdAndDelete(listingId);
      return c.body(null, 204);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);

export default listings;
