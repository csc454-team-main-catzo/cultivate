import type { UserRole } from "../types";

export interface AgentTheme {
  primary: string;
  primaryHover: string;
  primaryBg: string;
  primaryBorder: string;
  primaryButtonClass: string;
  roleLabel: string;
}

const FARMER_THEME: AgentTheme = {
  primary: "text-[#00674F]",
  primaryHover: "hover:text-[#00543f]",
  primaryBg: "bg-[#00674F]",
  primaryBorder: "border-[#00674F]",
  primaryButtonClass: "bg-[#00674F] hover:bg-[#00543f] text-white",
  roleLabel: "Sourcing",
};

const RESTAURANT_THEME: AgentTheme = {
  primary: "text-blue-600",
  primaryHover: "hover:text-blue-700",
  primaryBg: "bg-blue-500",
  primaryBorder: "border-blue-500",
  primaryButtonClass: "bg-blue-600 hover:bg-blue-700 text-white",
  roleLabel: "Sourcing",
};

export function getAgentTheme(role: UserRole | undefined): AgentTheme {
  if (role === "farmer") return FARMER_THEME;
  if (role === "restaurant") return RESTAURANT_THEME;
  return FARMER_THEME;
}
