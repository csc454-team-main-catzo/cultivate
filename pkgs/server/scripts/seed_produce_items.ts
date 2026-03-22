import mongoose from "mongoose";
import CFG from "../src/config.js";
import ProduceItem from "../src/models/ProduceItem.js";

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Unit = "kg" | "lb" | "count" | "bunch";
type PriceHint = {
  unit: Unit;
  currency: "CAD";
  typicalMin: number;
  typicalMax: number;
  suggested: number;
  source: string;
  referencePeriod: string;
  notes?: string;
};

// Initial seed prices from AAFC Infohort Daily Wholesale-to-Retail Market Prices (Toronto).
// These are *bootstrap* values only — the daily price updater replaces them with live data.
// Source: https://open.canada.ca/data/en/dataset/920bc8e2-de26-4bf6-ac41-ed47962d0ff6
const AAFC_SEED: Record<string, PriceHint> = {
  apple: {
    unit: "kg",
    currency: "CAD",
    typicalMin: 2.65,
    typicalMax: 4.85,
    suggested: 4.50,
    source: "aafc_infohort_toronto",
    referencePeriod: "seed",
    notes: "Bootstrap from AAFC Infohort wholesale (Toronto). Replaced daily by live data.",
  },
  banana: {
    unit: "kg",
    currency: "CAD",
    typicalMin: 1.10,
    typicalMax: 1.76,
    suggested: 1.72,
    source: "aafc_infohort_toronto",
    referencePeriod: "seed",
    notes: "Bootstrap from AAFC Infohort wholesale (Toronto). Replaced daily by live data.",
  },
  potato: {
    unit: "kg",
    currency: "CAD",
    typicalMin: 1.10,
    typicalMax: 2.20,
    suggested: 1.98,
    source: "aafc_infohort_toronto",
    referencePeriod: "seed",
    notes: "Bootstrap from AAFC Infohort wholesale (Toronto). Replaced daily by live data.",
  },
  tomato: {
    unit: "kg",
    currency: "CAD",
    typicalMin: 2.65,
    typicalMax: 6.61,
    suggested: 5.56,
    source: "aafc_infohort_toronto",
    referencePeriod: "seed",
    notes: "Bootstrap from AAFC Infohort wholesale (Toronto). Replaced daily by live data.",
  },
  carrot: {
    unit: "kg",
    currency: "CAD",
    typicalMin: 0.88,
    typicalMax: 2.20,
    suggested: 1.85,
    source: "aafc_infohort_toronto",
    referencePeriod: "seed",
    notes: "Bootstrap from AAFC Infohort wholesale (Toronto). Replaced daily by live data.",
  },
  pepper: {
    unit: "kg",
    currency: "CAD",
    typicalMin: 3.31,
    typicalMax: 6.61,
    suggested: 5.95,
    source: "aafc_infohort_toronto",
    referencePeriod: "seed",
    notes: "Bootstrap from AAFC Infohort wholesale (Toronto). Replaced daily by live data.",
  },
  onion: {
    unit: "kg",
    currency: "CAD",
    typicalMin: 0.66,
    typicalMax: 1.76,
    suggested: 1.45,
    source: "aafc_infohort_toronto",
    referencePeriod: "seed",
    notes: "Bootstrap from AAFC Infohort wholesale (Toronto). Replaced daily by live data.",
  },
  cucumber: {
    unit: "kg",
    currency: "CAD",
    typicalMin: 1.76,
    typicalMax: 3.97,
    suggested: 3.44,
    source: "aafc_infohort_toronto",
    referencePeriod: "seed",
    notes: "Bootstrap from AAFC Infohort wholesale (Toronto). Replaced daily by live data.",
  },
  lettuce: {
    unit: "kg",
    currency: "CAD",
    typicalMin: 1.76,
    typicalMax: 4.41,
    suggested: 3.70,
    source: "aafc_infohort_toronto",
    referencePeriod: "seed",
    notes: "Bootstrap from AAFC Infohort wholesale (Toronto). Replaced daily by live data.",
  },
  broccoli: {
    unit: "kg",
    currency: "CAD",
    typicalMin: 2.20,
    typicalMax: 4.41,
    suggested: 3.97,
    source: "aafc_infohort_toronto",
    referencePeriod: "seed",
    notes: "Bootstrap from AAFC Infohort wholesale (Toronto). Replaced daily by live data.",
  },
  mushroom: {
    unit: "kg",
    currency: "CAD",
    typicalMin: 4.41,
    typicalMax: 8.82,
    suggested: 7.94,
    source: "aafc_infohort_toronto",
    referencePeriod: "seed",
    notes: "Bootstrap from AAFC Infohort wholesale (Toronto). Replaced daily by live data.",
  },
};

// MVP seed set: common produce in Canada + practical synonyms for matching.
// Pricing/unit hints are bootstrapped from AAFC Infohort and refreshed daily at runtime.
const seedItems: Array<{
  canonical: string;
  synonyms: string[];
  defaultUnit?: Unit;
  commonUnits?: Unit[];
  priceHints?: PriceHint[];
}> = [
  // Leafy greens
  {
    canonical: "lettuce",
    synonyms: ["romaine", "iceberg", "leaf lettuce", "mixed greens", "salad greens"],
    defaultUnit: "count",
    commonUnits: ["count"],
    priceHints: [AAFC_SEED.lettuce],
  },
  { canonical: "spinach", synonyms: ["baby spinach"], defaultUnit: "bunch", commonUnits: ["bunch"] },
  { canonical: "kale", synonyms: ["curly kale", "lacinato kale", "dinosaur kale"], defaultUnit: "bunch", commonUnits: ["bunch"] },
  { canonical: "arugula", synonyms: ["rocket"], defaultUnit: "bunch", commonUnits: ["bunch"] },
  { canonical: "cabbage", synonyms: ["green cabbage", "red cabbage", "savoy cabbage"], defaultUnit: "count", commonUnits: ["count"] },
  { canonical: "bok choy", synonyms: ["pak choi", "baby bok choy"], defaultUnit: "bunch", commonUnits: ["bunch"] },

  // Herbs
  { canonical: "cilantro", synonyms: ["coriander", "coriander leaves"], defaultUnit: "bunch", commonUnits: ["bunch"] },
  { canonical: "parsley", synonyms: ["flat-leaf parsley", "italian parsley", "curly parsley"], defaultUnit: "bunch", commonUnits: ["bunch"] },
  { canonical: "basil", synonyms: ["sweet basil"], defaultUnit: "bunch", commonUnits: ["bunch"] },
  { canonical: "mint", synonyms: ["spearmint"], defaultUnit: "bunch", commonUnits: ["bunch"] },
  { canonical: "dill", synonyms: [], defaultUnit: "bunch", commonUnits: ["bunch"] },

  // Staples / vegetables
  {
    canonical: "tomato",
    synonyms: ["tomatoes", "roma tomato", "cherry tomato", "grape tomato"],
    defaultUnit: "kg",
    commonUnits: ["kg", "lb"],
    priceHints: [AAFC_SEED.tomato],
  },
  { canonical: "cucumber", synonyms: ["cucumbers", "english cucumber", "mini cucumber"], defaultUnit: "count", commonUnits: ["count"], priceHints: [AAFC_SEED.cucumber] },
  { canonical: "zucchini", synonyms: ["courgette"], defaultUnit: "kg", commonUnits: ["kg", "lb"] },
  { canonical: "pepper", synonyms: ["bell pepper", "sweet pepper", "capsicum", "red pepper", "green pepper", "yellow pepper"], defaultUnit: "kg", commonUnits: ["kg", "lb", "count"], priceHints: [AAFC_SEED.pepper] },
  { canonical: "jalapeño", synonyms: ["jalapeno", "chili pepper", "green chili"], defaultUnit: "kg", commonUnits: ["kg", "lb"] },
  { canonical: "broccoli", synonyms: ["broccoli florets"], defaultUnit: "kg", commonUnits: ["kg", "lb"], priceHints: [AAFC_SEED.broccoli] },
  { canonical: "cauliflower", synonyms: [], defaultUnit: "count", commonUnits: ["count"] },
  { canonical: "celery", synonyms: ["celery stalk"], defaultUnit: "count", commonUnits: ["count"] },
  { canonical: "corn", synonyms: ["sweet corn", "corn on the cob", "maize"], defaultUnit: "count", commonUnits: ["count"] },
  { canonical: "green bean", synonyms: ["green beans", "string bean", "snap bean"], defaultUnit: "kg", commonUnits: ["kg", "lb"] },
  { canonical: "pea", synonyms: ["peas", "green pea", "snap pea", "snow pea"], defaultUnit: "kg", commonUnits: ["kg", "lb"] },
  { canonical: "eggplant", synonyms: ["aubergine"], defaultUnit: "kg", commonUnits: ["kg", "lb", "count"] },
  { canonical: "asparagus", synonyms: [], defaultUnit: "bunch", commonUnits: ["bunch"] },
  { canonical: "brussels sprout", synonyms: ["brussels sprouts"], defaultUnit: "kg", commonUnits: ["kg", "lb"] },

  // Alliums
  { canonical: "onion", synonyms: ["yellow onion", "red onion", "white onion"], defaultUnit: "kg", commonUnits: ["kg", "lb"], priceHints: [AAFC_SEED.onion] },
  { canonical: "green onion", synonyms: ["scallion", "spring onion"], defaultUnit: "bunch", commonUnits: ["bunch"] },
  { canonical: "garlic", synonyms: ["garlic bulb"], defaultUnit: "kg", commonUnits: ["kg", "lb", "count"] },
  { canonical: "leek", synonyms: ["leeks"], defaultUnit: "count", commonUnits: ["count"] },

  // Root veg
  {
    canonical: "potato",
    synonyms: ["potatoes", "russet", "yukon gold", "red potato"],
    defaultUnit: "kg",
    commonUnits: ["kg", "lb"],
    priceHints: [AAFC_SEED.potato],
  },
  { canonical: "sweet potato", synonyms: ["sweet potatoes", "yam"], defaultUnit: "kg", commonUnits: ["kg", "lb"] },
  { canonical: "carrot", synonyms: ["carrots"], defaultUnit: "kg", commonUnits: ["kg", "lb"], priceHints: [AAFC_SEED.carrot] },
  { canonical: "beet", synonyms: ["beets", "beetroot"], defaultUnit: "kg", commonUnits: ["kg", "lb"] },
  { canonical: "turnip", synonyms: ["turnips"], defaultUnit: "kg", commonUnits: ["kg", "lb"] },
  { canonical: "rutabaga", synonyms: ["swede"], defaultUnit: "kg", commonUnits: ["kg", "lb"] },
  { canonical: "parsnip", synonyms: ["parsnips"], defaultUnit: "kg", commonUnits: ["kg", "lb"] },
  { canonical: "radish", synonyms: ["radishes", "daikon"], defaultUnit: "bunch", commonUnits: ["bunch", "kg"] },

  // Squash
  { canonical: "squash", synonyms: ["butternut squash", "acorn squash"], defaultUnit: "kg", commonUnits: ["kg", "lb", "count"] },
  { canonical: "pumpkin", synonyms: [], defaultUnit: "count", commonUnits: ["count"] },

  // Mushrooms
  { canonical: "mushroom", synonyms: ["mushrooms", "button mushroom", "cremini", "portobello", "shiitake"], defaultUnit: "kg", commonUnits: ["kg", "lb"], priceHints: [AAFC_SEED.mushroom] },

  // Fruits
  {
    canonical: "apple",
    synonyms: ["apples"],
    defaultUnit: "kg",
    commonUnits: ["kg", "lb", "count"],
    priceHints: [AAFC_SEED.apple],
  },
  { canonical: "pear", synonyms: ["pears"], defaultUnit: "kg", commonUnits: ["kg", "lb", "count"] },
  { canonical: "orange", synonyms: ["oranges"], defaultUnit: "kg", commonUnits: ["kg", "lb", "count"] },
  {
    canonical: "banana",
    synonyms: ["bananas"],
    defaultUnit: "kg",
    commonUnits: ["kg", "lb", "count"],
    priceHints: [AAFC_SEED.banana],
  },
  { canonical: "grape", synonyms: ["grapes"], defaultUnit: "kg", commonUnits: ["kg", "lb"] },
  { canonical: "strawberry", synonyms: ["strawberries"], defaultUnit: "count", commonUnits: ["count"] },
  { canonical: "blueberry", synonyms: ["blueberries"], defaultUnit: "count", commonUnits: ["count"] },
  { canonical: "raspberry", synonyms: ["raspberries"], defaultUnit: "count", commonUnits: ["count"] },
  { canonical: "blackberry", synonyms: ["blackberries"], defaultUnit: "count", commonUnits: ["count"] },
];

async function run() {
  await mongoose.connect(CFG.MONGODB_URI);
  console.log("Connected to MongoDB");

  for (const entry of seedItems) {
    const canonical = entry.canonical.trim();
    const name = slugify(canonical);
    const normalizedSynonyms = entry.synonyms.map((s) => s.trim().toLowerCase());

    const existing =
      (await ProduceItem.findOne({ name })) ||
      (await ProduceItem.findOne({
        canonical: { $regex: `^${escapeRegex(canonical)}$`, $options: "i" },
      }));

    const patch = {
      canonical,
      name,
      active: true,
      synonyms: normalizedSynonyms,
      // these fields must exist on your ProduceItem schema for this to persist
      defaultUnit: entry.defaultUnit,
      commonUnits: entry.commonUnits,
      priceHints: entry.priceHints,
    };

    if (existing) {
      existing.canonical = canonical;
      existing.name = name;
      existing.active = true;

      existing.synonyms = Array.from(
        new Set([...(existing.synonyms || []), ...normalizedSynonyms])
      );

      // Only set if provided in seed (don’t wipe if undefined)
      if (entry.defaultUnit) (existing as any).defaultUnit = entry.defaultUnit;
      if (entry.commonUnits?.length) (existing as any).commonUnits = entry.commonUnits;

      // Merge priceHints by (source, referencePeriod, unit)
      if (entry.priceHints?.length) {
        const cur: PriceHint[] = ((existing as any).priceHints || []) as PriceHint[];
        const merged = [...cur];

        for (const h of entry.priceHints) {
          const key = `${h.source}:${h.referencePeriod}:${h.unit}`;
          const idx = merged.findIndex(
            (x) => `${x.source}:${x.referencePeriod}:${x.unit}` === key
          );
          if (idx >= 0) merged[idx] = h;
          else merged.push(h);
        }
        (existing as any).priceHints = merged;
      }

      await existing.save();
      continue;
    }

    await ProduceItem.create({
      canonical,
      name,
      active: true,
      synonyms: normalizedSynonyms,
      defaultUnit: entry.defaultUnit,
      commonUnits: entry.commonUnits,
      priceHints: entry.priceHints,
    });
  }

  console.log(`Seeded ${seedItems.length} produce taxonomy items`);
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Seed failed:", error);
  await mongoose.disconnect();
  process.exit(1);
});