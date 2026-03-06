/**
 * Agent sourcing message and payload types.
 * Messages can be plain text, a product grid (restaurant), or an inventory draft form (farmer).
 */

export type MessageRole = "user" | "assistant";

export type MessageContentType = "text" | "product_grid" | "inventory_form";

export interface AgentMessageBase {
  id: string;
  role: MessageRole;
  type: MessageContentType;
  createdAt: Date;
}

export interface TextMessage extends AgentMessageBase {
  type: "text";
  content: string;
  /** When true, content is still streaming (simulated). */
  isStreaming?: boolean;
}

export interface ProductGridItem {
  id: string;
  listingId: string;
  title: string;
  item: string;
  description?: string;
  price: number;
  qty: number;
  unit?: string;
  farmerName: string;
  farmerId: string;
  /** From API: listing photo id; frontend can resolve to imageUrl. */
  imageId?: string;
  imageUrl?: string;
}

export interface ProductGridMessage extends AgentMessageBase {
  type: "product_grid";
  query: string;
  items: ProductGridItem[];
}

export interface InventoryDraftData {
  title: string;
  item: string;
  description?: string;
  weightKg: number;
  pricePerKg: number;
  unit?: "kg" | "lb" | "count" | "bunch";
}

export interface InventoryFormMessage extends AgentMessageBase {
  type: "inventory_form";
  draft: InventoryDraftData;
  /** Raw user message that led to this draft */
  userMessage?: string;
}

export type AgentMessage =
  | TextMessage
  | ProductGridMessage
  | InventoryFormMessage;

export type UserRole = "farmer" | "restaurant" | "admin";
