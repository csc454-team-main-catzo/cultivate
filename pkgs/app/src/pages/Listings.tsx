import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../providers/apiContext";

interface Listing {
  _id: string;
  type: "demand" | "supply";
  title: string;
  item: string;
  description: string;
  price: number;
  qty: number;
  unit?: string;
  status: string;
  createdBy: { _id: string; name: string; email: string; role?: "farmer" | "restaurant" };
  responses?: unknown[];
  createdAt: string;
}

export default function Listings() {
  const { listings: listingsApi } = useApi();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchListings() {
      setLoading(true);
      try {
        const response = await listingsApi.listListings();
        // Axios wraps the payload in { data: [...] }
        const items = (response as any).data ?? response;
        setListings(Array.isArray(items) ? items : []);
      } catch (err) {
        console.error("Failed to fetch listings:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchListings();
  }, [listingsApi]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">Listings</h1>
        <Link to="/agent?new=1" className="btn-primary shrink-0">
          + New Listing
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-leaf-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-zinc-500 text-sm font-medium">Loading listings...</p>
          </div>
        </div>
      ) : listings.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-zinc-600 mb-2">No listings yet.</p>
          <Link to="/agent?new=1" className="text-leaf-600 font-medium hover:text-leaf-700">
            Create one
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {listings.map((l) => (
            <li key={l._id}>
              <Link
                to={`/listings/${l._id}`}
                className="card p-4 sm:p-5 block hover:shadow-card-hover"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-block text-xs font-medium px-3 py-1 rounded-full ${
                        l.createdBy?.role === "restaurant"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-[#E0F2EB] text-[#00674F]"
                      }`}
                    >
                      {l.createdBy?.role === "restaurant"
                        ? "Restaurant"
                        : l.createdBy?.role === "farmer"
                          ? "Farmer"
                          : l.type === "demand"
                            ? "Restaurant"
                            : "Farmer"}
                    </span>
                    <span className="font-semibold text-zinc-900">{l.title}</span>
                    {Array.isArray(l.responses) && l.responses.length > 0 && (
                      <span className="text-xs text-zinc-500">
                        {l.responses.length} response{l.responses.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <time className="text-sm text-zinc-400">
                    {new Date(l.createdAt).toLocaleDateString()}
                  </time>
                </div>
                <p className="text-zinc-600 text-sm mt-2 line-clamp-2">{l.description}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm text-zinc-500">
                  <span>{l.item}</span>
                  <span>Qty: {l.qty} {l.unit ?? "kg"}</span>
                  <span>${l.price.toFixed(2)}/{l.unit ?? "kg"}</span>
                  <span className="capitalize">{l.status}</span>
                </div>
                <p className="text-xs text-zinc-400 mt-2">
                  by {l.createdBy?.name || "Unknown"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}