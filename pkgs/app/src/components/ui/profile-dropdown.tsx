import * as React from "react";
import { Link } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import { User, LogOut, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Profile {
  name: string;
  email?: string;
  avatar?: string;
}

const DEFAULT_AVATAR =
  "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=80&h=80&fit=crop";

interface ProfileDropdownProps extends React.HTMLAttributes<HTMLDivElement> {
  data: Profile;
}

export function ProfileDropdown({ data, className, ...props }: ProfileDropdownProps) {
  const { logout } = useAuth0();
  const avatar = data.avatar ?? DEFAULT_AVATAR;

  return (
    <div className={cn("relative", className)} {...props}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium text-zinc-900 hover:bg-zinc-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2"
          >
            <div className="w-6 h-6 rounded-full overflow-hidden bg-zinc-200 shrink-0">
              <img
                src={avatar}
                alt={data.name}
                width={24}
                height={24}
                className="w-full h-full object-cover"
              />
            </div>
            <span className="max-w-[120px] truncate">{data.name}</span>
            <ChevronDown className="w-4 h-4 shrink-0 text-zinc-500" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          sideOffset={4}
          className="w-56 p-1.5 bg-white border border-zinc-200 rounded-lg shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 origin-top-right"
        >
          <DropdownMenuItem asChild>
            <Link
              to="/profile"
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer focus:bg-zinc-100 focus:text-zinc-900"
            >
              <User className="w-4 h-4" />
              Profile
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator className="my-1" />

          <DropdownMenuItem asChild>
            <button
              type="button"
              onClick={() =>
                logout({ logoutParams: { returnTo: window.location.origin } })
              }
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-red-600 hover:bg-red-50 cursor-pointer focus:bg-red-50 focus:text-red-700"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
