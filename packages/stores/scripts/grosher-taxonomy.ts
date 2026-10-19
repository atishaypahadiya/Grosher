// Grosher's own store (design/store-grosher.md): what sits where. The demo Supercenter's 298 categories
// (scripts/taxonomy.ts) are reused by id and placed on Grosher's faces; the categories Walmart grocery had no
// shelf for (alcohol, bulk, floral, kitchenware, the food hall and café, papad) are new here. Geometry lives
// in gen-grosher.ts; this file only says which categories hang on which face, in order from the
// entrance-facing end.
//
// Storage (chilled / frozen / hot) is the category's, never the item's words: the food hall's hot bar,
// soups and rotisserie are hot; sushi, the salad bar, the deli and cold beer are chilled.

import type { Department, ItemTag, Stop } from "@grosher/core";
import type { TaxCategory } from "./taxonomy.ts";

const c = (id: string, name: string, aliases: string[] = [], tags?: ItemTag[]): TaxCategory => (tags ? { id, name, aliases, tags } : { id, name, aliases });

/**
 * Departments: one per aisle sign (the chip reads "A4 · world foods"), one per counter or station on the
 * perimeter ("Sushi · last"). No blue (DESIGN.md §7). The finish picks the 3D material; departments that
 * share one share a mesh, so the count costs no draw calls.
 */
export const GROSHER_DEPARTMENTS: Department[] = [
  { id: "produce", name: "Produce", color: "#6CB26A", texture: "produce.jpg", fixtureKind: "produce", finish: "stainless" },
  { id: "bulk", name: "Bulk", color: "#D9B98C", texture: "dry.jpg", fixtureKind: "bins", finish: "wood" },
  { id: "floral", name: "Floral", color: "#E9A6A0", texture: "produce.jpg", fixtureKind: "produce", finish: "wood" },
  { id: "service", name: "Customer service", color: "#D8D4CC", fixtureKind: "counter", finish: "wood" },
  { id: "pharmacy", name: "Pharmacy", color: "#CFE3DA", texture: "pharmacy.jpg", fixtureKind: "gondola", finish: "wood" },
  { id: "bodycare", name: "Body care", color: "#E8D2C4", texture: "baby.jpg", fixtureKind: "gondola", finish: "wood" },
  { id: "checkout", name: "Checkout", color: "#DCE3D4", fixtureKind: "counter", finish: "wood" },
  { id: "seating", name: "Seating", color: "#CDBFA8", fixtureKind: "bakery", finish: "wood" },
  { id: "seafood", name: "Seafood", color: "#E7C3B8", texture: "meat.jpg", fixtureKind: "servicecase", finish: "stainless" },
  { id: "meat", name: "Meat", color: "#E5A2A0", texture: "meat.jpg", fixtureKind: "servicecase", finish: "stainless" },
  { id: "dairy", name: "Dairy", color: "#F2EAD2", texture: "dairy.jpg", fixtureKind: "coldcase", finish: "stainless" },
  { id: "cheese", name: "Cheese", color: "#F3DA8E", texture: "dairy.jpg", fixtureKind: "servicecase", finish: "stainless" },
  { id: "breakfast", name: "Breakfast", color: "#E2C9A2", texture: "dry.jpg", fixtureKind: "gondola", finish: "wood" },
  { id: "baking", name: "Baking", color: "#E6CFA8", texture: "dry.jpg", fixtureKind: "gondola", finish: "wood" },
  { id: "pasta", name: "Pasta & rice", color: "#E8C79A", texture: "dry.jpg", fixtureKind: "gondola", finish: "wood" },
  { id: "world", name: "World foods", color: "#E9B98A", texture: "dry.jpg", fixtureKind: "gondola", finish: "wood" },
  { id: "canned", name: "Canned", color: "#DDC4A0", texture: "dry.jpg", fixtureKind: "gondola", finish: "wood" },
  { id: "snack", name: "Snacks", color: "#F3C96B", texture: "snack.jpg", fixtureKind: "gondola", finish: "wood" },
  { id: "drinks", name: "Drinks", color: "#C9DDA0", texture: "drinks.jpg", fixtureKind: "gondola", finish: "wood" },
  { id: "household", name: "Household", color: "#D8D4CC", texture: "household.jpg", fixtureKind: "gondola", finish: "wood" },
  { id: "kitchen", name: "Kitchen", color: "#D3C7B5", texture: "household.jpg", fixtureKind: "gondola", finish: "wood" },
  { id: "babypet", name: "Baby & pet", color: "#E7D3CF", texture: "pet.jpg", fixtureKind: "gondola", finish: "wood" },
  { id: "alcohol", name: "Beer & wine", color: "#C99A8E", texture: "drinks.jpg", fixtureKind: "gondola", finish: "wood" },
  { id: "winebar", name: "Wine bar", color: "#B98579", fixtureKind: "counter", finish: "wood" },
  { id: "frozen", name: "Frozen", color: "#E1ECD8", texture: "frozen.jpg", fixtureKind: "coldcase", finish: "stainless" },
  { id: "cafe", name: "Café", color: "#D9B48A", texture: "bakery.jpg", fixtureKind: "counter", finish: "wood" },
  { id: "hotbar", name: "Hot bar", color: "#F0B27A", texture: "deli.jpg", fixtureKind: "servicecase", finish: "stainless" },
  { id: "saladbar", name: "Salad bar", color: "#A9CF8C", texture: "produce.jpg", fixtureKind: "servicecase", finish: "stainless" },
  { id: "soups", name: "Soups", color: "#E8A86E", texture: "deli.jpg", fixtureKind: "servicecase", finish: "stainless" },
  { id: "rotisserie", name: "Rotisserie", color: "#E9A15F", texture: "deli.jpg", fixtureKind: "servicecase", finish: "stainless" },
  { id: "sushi", name: "Sushi", color: "#EFC0B0", texture: "deli.jpg", fixtureKind: "servicecase", finish: "stainless" },
  { id: "pizza", name: "Pizza", color: "#EBB27C", texture: "bakery.jpg", fixtureKind: "servicecase", finish: "stainless" },
  { id: "deli", name: "Deli", color: "#EFC9A6", texture: "deli.jpg", fixtureKind: "servicecase", finish: "stainless" },
  { id: "bakery", name: "Bakery", color: "#E9B46A", texture: "bakery.jpg", fixtureKind: "servicecase", finish: "wood" },
];

/** Categories the demo Supercenter has no shelf for. */
export const NEW_CATEGORIES: TaxCategory[] = [
  // world foods (aisle 4): papad was an alias of the namkeen category; Grosher shelves it on its own
  c("papad", "Papad & fryums", ["papad", "papadum", "pappadam", "poppadom", "appalam", "fryums", "lijjat"]),
  // kitchen & home (aisle 9)
  c("cookware", "Cookware & bakeware", ["frying pan", "skillet", "saucepan", "pots and pans", "nonstick pan", "cast iron skillet", "baking sheet", "cake pan", "muffin tin", "tawa", "pressure cooker", "kadai", "wok", "dutch oven"]),
  c("kitchen-utensils", "Kitchen utensils & gadgets", ["spatula", "whisk", "tongs", "ladle", "peeler", "vegetable peeler", "can opener", "measuring cups", "measuring spoons", "cutting board", "kitchen knife", "chef knife", "grater", "colander", "wooden spoon", "rolling pin", "belan"]),
  // beer, wine & spirits (aisles 11–13)
  c("cold-beer", "Cold beer", ["cold beer", "chilled beer", "beer cold", "cold six pack", "cold beer six pack"], ["chilled"]),
  c("beer", "Beer", ["beer", "craft beer", "ipa", "lager", "ale", "stout", "pilsner", "six pack of beer", "beer 12 pack"]),
  c("cider-seltzer", "Hard cider & seltzer", ["hard cider", "hard seltzer", "white claw", "truly", "spiked seltzer"]),
  c("white-wine", "White & rosé wine", ["white wine", "chardonnay", "sauvignon blanc", "pinot grigio", "riesling", "rose wine", "rosé", "moscato"]),
  c("sparkling-wine", "Sparkling wine & champagne", ["champagne", "prosecco", "cava", "sparkling wine", "bubbly"]),
  c("red-wine", "Red wine", ["red wine", "cabernet", "cabernet sauvignon", "merlot", "pinot noir", "malbec", "zinfandel", "syrah", "shiraz"]),
  c("spirits", "Spirits", ["vodka", "whiskey", "whisky", "bourbon", "tequila", "rum", "gin", "scotch", "brandy", "liquor", "mezcal"]),
  c("wine-bar", "Wine bar & tastings", ["wine bar", "wine tasting", "wine by the glass", "tasting bar"]),
  // bulk (north band)
  c("bulk-pulses", "Bulk pulses & dal", ["bulk dal", "bulk lentils", "bulk beans", "bulk toor dal", "toor dal bulk", "bulk moong dal", "moong dal bulk", "bulk masoor dal", "masoor dal bulk", "bulk chana dal", "chana dal bulk", "bulk chana", "bulk rajma", "rajma bulk", "bulk chickpeas"]),
  c("bulk-rice-grains", "Bulk rice & grains", ["bulk rice", "bulk basmati", "basmati rice bulk", "bulk quinoa", "bulk oats", "bulk grains", "bulk barley", "bulk millet"]),
  c("bulk-flours", "Bulk flours", ["bulk flour", "bulk atta", "atta bulk", "bulk besan", "bulk whole wheat flour", "bulk almond flour"]),
  c("bulk-nuts-seeds", "Bulk nuts & seeds", ["bulk nuts", "bulk almonds", "bulk cashews", "bulk walnuts", "bulk pistachios", "bulk seeds", "bulk chia seeds", "bulk trail mix"]),
  c("bulk-snacks", "Bulk granola, trail mix & snacks", ["bulk granola", "granola bulk", "bulk trail mix", "trail mix bulk", "bulk muesli", "bulk chocolate chips", "bulk coffee beans", "scoop bins"]),
  c("bulk-dried-fruit", "Bulk dried fruit", ["bulk dried fruit", "bulk raisins", "bulk dates", "bulk apricots", "bulk dried cranberries", "bulk figs"]),
  // floral and customer service (west column, by the entrance)
  c("bouquets", "Bouquets & cut flowers", ["flowers", "bouquet", "fresh flowers", "cut flowers", "roses", "tulips", "sunflowers", "lilies", "flower bouquet"]),
  c("plants", "Potted plants", ["potted plant", "plant", "house plant", "houseplant", "orchid", "succulent", "herb plant"]),
  c("service-desk", "Customer service", ["customer service", "service desk", "returns", "gift card", "gift cards", "stamps"]),
  // the food hall (south band): the hot ones are picked late, like cold food
  c("hot-bar", "Hot bar", ["hot bar", "hot food bar", "hot foods", "hot buffet"], ["hot"]),
  c("soups", "Soup bar", ["soup bar", "hot soup", "soup of the day", "chicken soup hot bar", "hot chicken soup", "fresh soup"], ["hot"]),
  c("salad-bar", "Salad bar", ["salad bar", "make your own salad", "salad bar salad"], ["chilled"]),
  c("sushi", "Sushi", ["sushi", "sushi platter", "sushi roll", "california roll", "spicy tuna roll", "nigiri", "sashimi", "poke bowl"], ["chilled"]),
  c("pizza", "Pizza counter", ["pizza slice", "pizza by the slice", "fresh pizza", "whole pizza", "hot pizza slice"]),
  // the café (south-west corner)
  c("cafe-coffee", "Coffee bar", ["latte", "cappuccino", "espresso", "americano", "chai latte", "coffee bar", "hot coffee", "flat white", "mocha"]),
  c("cafe-juice", "Juice & smoothie bar", ["smoothie", "smoothies", "fresh squeezed juice", "juice bar", "acai bowl", "green juice"]),
];

/**
 * Handling by the shelf (src/handling.ts). Heavy = about 2 kg or more for the typical unit on that shelf, so
 * the solver picks it early: cases of water, soda, sparkling water, sports drinks, beer and cider; gallon jugs
 * (milk, iced tea, shelf juice, bleach, detergent, fabric softener); big rice and atta bags, flour and sugar
 * bags; ghee tins and cooking-oil jugs; pet food and litter; charcoal; melons and 5 lb potato bags; bagged ice
 * and whole turkeys. Everything else is not heavy, whatever the source catalog said (it had 9,785 heavy rows:
 * every soup can, pasta sauce jar and paper towel). Bulky = big and light, rides under or on top of the cart,
 * no route penalty. Pinned in test/grosher.test.ts.
 */
export const HEAVY: string[] = [
  "bottled-water", "sparkling-water", "soda", "diet-soda", "sports-drinks", "iced-tea-lemonade", "juice-shelf", "beer", "cold-beer", "cider-seltzer",
  "milk", "basmati-indian-rice", "asian-rice-bags", "atta-flours", "flour", "sugar", "ghee-oils-indian", "cooking-oil",
  "laundry-detergent", "fabric-softener", "bleach", "charcoal-grilling", "dog-food", "cat-food", "cat-litter",
  "grapes-melons", "potatoes-roots", "ice", "frozen-turkey-ham",
];
export const BULKY: string[] = ["toilet-paper", "paper-towels", "facial-tissue", "diapers", "incontinence", "mops-brooms", "potato-chips", "tortilla-chips", "cheese-puffs", "popcorn"];

/** Grosher-only changes to reused categories: aliases added or removed, a name re-read for this store. */
export const CATEGORY_PATCHES: Record<string, { name?: string; add?: string[]; remove?: string[] }> = {
  // papad has its own shelf here
  "indian-snacks": { remove: ["papad"] },
  // a dal-chawal list means fresh chilies, not the canned Latin ones
  "tomatoes-peppers": { add: ["green chilies", "green chillies", "green chili", "hari mirch", "thai chilies", "serrano peppers"] },
  // the bar mixers keep only the mixers now that beer, wine and spirits have shelves
  mixers: { add: ["tonic water", "club soda", "bitters", "cocktail mix"] },
  // cold & flu: the way people write it
  "cold-flu": { add: ["cold and flu medicine", "cold medicine", "throat lozenges", "lozenges", "flu medicine"] },
};

export interface Face {
  /** the location's aisle code: "A4" for a centre aisle, a counter or wall name otherwise */
  aisle: string;
  /** the sign over the aisle or counter, as it reads */
  sign: string;
  department: string;
  /** category ids, from the entrance-facing end */
  cats: string[];
}

/**
 * Every face that carries categories, keyed by the id gen-grosher.ts lays it out under. Centre aisles: L is
 * the north side (the south face of the run above), R the south side. Aisle 1 is nearest produce.
 */
export const FACES: Record<string, Face> = {
  // ------------------------------------------------------------ centre aisles 1–10 (west bank)
  "A1-L": { aisle: "A1", sign: "Breakfast · Cereal · Oatmeal · Coffee · Tea", department: "breakfast", cats: ["cereal", "healthy-cereal", "hot-cereal", "granola", "breakfast-bars", "toaster-pastries", "pancake-waffle-mix", "breakfast-biscuits", "breakfast-drinks"] },
  "A1-R": { aisle: "A1", sign: "Breakfast · Cereal · Oatmeal · Coffee · Tea", department: "breakfast", cats: ["ground-coffee", "k-cups", "instant-coffee", "cold-brew", "coffee-filters", "creamer-shelf", "tea", "hot-cocoa", "peanut-butter", "jelly-jam", "hazelnut-spread", "honey-syrup"] },
  "A2-L": { aisle: "A2", sign: "Baking · Atta & flours · Spices · Oils & ghee", department: "baking", cats: ["flour", "atta-flours", "specialty-flours", "sugar", "baking-mixes", "baking-essentials", "baking-chips-nuts", "frosting-decorating", "food-coloring-extract", "pie-filling-pudding", "dessert-toppings", "evaporated-condensed", "shortening-lard"] },
  "A2-R": { aisle: "A2", sign: "Baking · Atta & flours · Spices · Oils & ghee", department: "baking", cats: ["cooking-oil", "ghee-oils-indian", "spices-herbs", "indian-spices", "seasoning-blends", "salt", "bouillon-cubes", "gravy-dry-mixes", "breading-coating", "croutons-breadcrumbs"] },
  "A3-L": { aisle: "A3", sign: "Pasta · Rice · Sauces · Grains", department: "pasta", cats: ["pasta", "gluten-free-pasta", "pasta-sauce", "mac-and-cheese", "boxed-meals-potatoes", "marinades-sauces", "bbq-sauce"] },
  "A3-R": { aisle: "A3", sign: "Pasta · Rice · Sauces · Grains", department: "pasta", cats: ["rice", "basmati-indian-rice", "asian-rice-bags", "rice-mixes", "dried-beans-lentils"] },
  "A4-L": { aisle: "A4", sign: "World foods · Indian · Masalas · Middle Eastern · Latin", department: "world", cats: ["dal-lentils", "indian-masala-blends", "indian-pickles-chutney", "papad", "indian-ready-meals", "indian-tea-drinks", "mediterranean", "kosher", "hispanic-tortillas", "tortillas-wraps"] },
  "A4-R": { aisle: "A4", sign: "World foods · Indian · Masalas · Middle Eastern · Latin", department: "world", cats: ["asian-noodles-rice", "asian-instant-noodles", "asian-sauces", "asian-chili-condiments", "coconut-milk-curry", "seaweed-asian-snacks", "salsa-taco", "mexican-sauces", "hispanic-spices", "hispanic-beans-rice", "hispanic-cooking", "hispanic-snacks-sweets", "hispanic-drinks"] },
  "A5-L": { aisle: "A5", sign: "Canned · Jarred · Soup · Condiments", department: "canned", cats: ["canned-vegetables", "canned-tomatoes", "canned-beans", "canned-fruit", "soup", "broth-stock", "chili-canned-meals", "canned-meat-fish", "ramen-instant"] },
  "A5-R": { aisle: "A5", sign: "Canned · Jarred · Soup · Condiments", department: "canned", cats: ["ketchup-mustard", "mayo", "hot-sauce", "salad-dressing", "pickles-olives", "vinegar", "gravy-mixes", "lemon-lime-juice"] },
  "A6-L": { aisle: "A6", sign: "Snacks · Namkeen · Chips · Nuts · Sweets", department: "snack", cats: ["potato-chips", "tortilla-chips", "cheese-puffs", "pretzels", "popcorn", "veggie-chips", "rice-cakes", "dips-salsa-jar", "indian-snacks", "nuts", "dried-fruit", "seeds-superfoods", "jerky", "crackers", "graham-crackers"] },
  "A6-R": { aisle: "A6", sign: "Snacks · Namkeen · Chips · Nuts · Sweets", department: "snack", cats: ["cookies", "international-biscuits", "snack-cakes", "rice-crispy-treats", "fruit-snacks-pouches", "kids-fruit-snacks", "protein-bars", "snack-packs", "chocolate-bars", "premium-chocolate", "gummy-candy", "hard-candy-mints", "gum", "seasonal-candy", "indian-sweets-shelf"] },
  "A7-L": { aisle: "A7", sign: "Drinks · Water · Sparkling · Soda · Juice", department: "drinks", cats: ["bottled-water", "sparkling-water", "soda", "diet-soda", "sports-drinks", "energy-drinks", "iced-tea-lemonade", "drink-mixes"] },
  "A7-R": { aisle: "A7", sign: "Drinks · Water · Sparkling · Soda · Juice", department: "drinks", cats: ["juice-shelf", "coconut-water-functional", "shelf-milk", "protein-shakes-ready", "bottled-coffee"] },
  "A8-L": { aisle: "A8", sign: "Household · Paper · Cleaning · Laundry", department: "household", cats: ["toilet-paper", "paper-towels", "facial-tissue", "trash-bags", "disposable-plates", "air-fresheners", "pest-control"] },
  "A8-R": { aisle: "A8", sign: "Household · Paper · Cleaning · Laundry", department: "household", cats: ["dish-soap", "all-purpose-cleaners", "bathroom-cleaners", "bleach", "glass-furniture-cleaners", "sponges-gloves", "mops-brooms", "laundry-detergent", "fabric-softener", "stain-remover", "laundry-supplies"] },
  "A9-L": { aisle: "A9", sign: "Kitchen & home · Cookware · Utensils · Food storage · Foil & wraps", department: "kitchen", cats: ["cookware", "kitchen-utensils", "kitchen-towels", "charcoal-grilling"] },
  "A9-R": { aisle: "A9", sign: "Kitchen & home · Cookware · Utensils · Food storage · Foil & wraps", department: "kitchen", cats: ["food-storage", "storage-containers", "batteries-lightbulbs", "hardware-basics"] },
  "A10-L": { aisle: "A10", sign: "Baby · Diapers · Formula · Pet · Dog · Cat", department: "babypet", cats: ["diapers", "baby-wipes", "baby-formula", "baby-food", "baby-bath-skin", "bottles-feeding", "baby-health"] },
  "A10-R": { aisle: "A10", sign: "Baby · Diapers · Formula · Pet · Dog · Cat", department: "babypet", cats: ["dog-food", "dog-treats-toys", "dog-supplies", "cat-food", "cat-litter", "cat-treats-supplies", "small-pet-fish-bird"] },

  // ------------------------------------------------------------ beer, wine & spirits (east bank)
  "A11-L": { aisle: "A11", sign: "Beer · Cold beer · Cider · Seltzer", department: "alcohol", cats: ["cold-beer"] },
  "A11-R": { aisle: "A11", sign: "Beer · Cold beer · Cider · Seltzer", department: "alcohol", cats: ["beer", "cider-seltzer"] },
  "A12-L": { aisle: "A12", sign: "Wine · White · Rosé · Sparkling · Red", department: "alcohol", cats: ["white-wine", "sparkling-wine"] },
  "A12-R": { aisle: "A12", sign: "Wine · White · Rosé · Sparkling · Red", department: "alcohol", cats: ["red-wine"] },
  "A13-L": { aisle: "A13", sign: "Spirits · Mixers · Bar", department: "alcohol", cats: ["spirits"] },
  "A13-R": { aisle: "A13", sign: "Spirits · Mixers · Bar", department: "alcohol", cats: ["mixers"] },
  WINEBAR: { aisle: "WINEBAR", sign: "Wine bar", department: "winebar", cats: ["wine-bar"] },

  // ------------------------------------------------------------ north band
  "PRODUCE-WALL": { aisle: "PRODUCE", sign: "Produce · Greens · Herbs · Cut fruit", department: "produce", cats: ["salad-greens", "fresh-herbs", "mushrooms-sprouts", "cut-vegetables", "cut-fruit-juice"] },
  // islands, two rows of four, west to east; one category per face that carries one
  "PRODUCE-I1N": { aisle: "PRODUCE", sign: "Produce · Fruit", department: "produce", cats: ["apples-pears"] },
  "PRODUCE-I1S": { aisle: "PRODUCE", sign: "Produce · Fruit", department: "produce", cats: ["citrus"] },
  "PRODUCE-I2N": { aisle: "PRODUCE", sign: "Produce · Fruit", department: "produce", cats: ["berries"] },
  "PRODUCE-I3N": { aisle: "PRODUCE", sign: "Produce · Fruit", department: "produce", cats: ["grapes-melons"] },
  "PRODUCE-I4N": { aisle: "PRODUCE", sign: "Produce · Fruit", department: "produce", cats: ["tropical-fruit"] },
  "PRODUCE-I4S": { aisle: "PRODUCE", sign: "Produce · Fruit", department: "produce", cats: ["bananas"] },
  "PRODUCE-I5N": { aisle: "PRODUCE", sign: "Produce · Vegetables", department: "produce", cats: ["tomatoes-peppers"] },
  "PRODUCE-I6N": { aisle: "PRODUCE", sign: "Produce · Vegetables", department: "produce", cats: ["onions-garlic"] },
  "PRODUCE-I7N": { aisle: "PRODUCE", sign: "Produce · Vegetables", department: "produce", cats: ["potatoes-roots"] },
  "PRODUCE-I8N": { aisle: "PRODUCE", sign: "Produce · Vegetables", department: "produce", cats: ["cooking-vegetables"] },
  // the bulk wall reads like its header boards, west to east: PULSES & DALS · RICE & GRAINS · FLOURS & ATTA ·
  // NUTS & SEEDS · DRIED FRUIT (apps/web/src/hero/bulk is the close-up of this zone); the island is scoop bins
  "BULK-WALL": { aisle: "BULK", sign: "Bulk · Pulses & dals · Rice & grains · Flours & atta · Nuts & seeds · Dried fruit", department: "bulk", cats: ["bulk-pulses", "bulk-rice-grains", "bulk-flours", "bulk-nuts-seeds", "bulk-dried-fruit"] },
  "BULK-ISLAND-N": { aisle: "BULK", sign: "Bulk · Scoop bins · Granola · Trail mix", department: "bulk", cats: ["bulk-snacks"] },

  // ------------------------------------------------------------ west column
  FLORAL: { aisle: "FLORAL", sign: "Floral · Bouquets · Plants", department: "floral", cats: ["bouquets", "plants"] },
  SERVICE: { aisle: "SERVICE", sign: "Customer service", department: "service", cats: ["service-desk"] },
  RX: { aisle: "PHARMACY", sign: "Pharmacy · Prescription pickup", department: "pharmacy", cats: ["pharmacy-counter"] },
  "OTC1-N": { aisle: "PHARMACY", sign: "Pharmacy · Pain relief · Cold & flu · Vitamins", department: "pharmacy", cats: ["pain-relief", "cold-flu", "allergy-sinus"] },
  "OTC1-S": { aisle: "PHARMACY", sign: "Pharmacy · Pain relief · Cold & flu · Vitamins", department: "pharmacy", cats: ["digestive", "eye-ear-care", "first-aid", "sleep-aids"] },
  "OTC2-N": { aisle: "PHARMACY", sign: "Pharmacy · Pain relief · Cold & flu · Vitamins", department: "pharmacy", cats: ["vitamins", "protein-powder", "kids-medicine", "thermometers"] },
  "OTC2-S": { aisle: "PHARMACY", sign: "Pharmacy · Pain relief · Cold & flu · Vitamins", department: "pharmacy", cats: ["diabetes-care", "foot-care", "incontinence", "smoking-cessation"] },
  "BODY1-N": { aisle: "BODYCARE", sign: "Body care · Soap · Hair · Oral care · Shaving", department: "bodycare", cats: ["body-wash-soap", "hand-soap-sanitizer", "lotion-skin-care", "facial-care"] },
  "BODY1-S": { aisle: "BODYCARE", sign: "Body care · Soap · Hair · Oral care · Shaving", department: "bodycare", cats: ["shampoo-conditioner", "hair-styling", "hair-accessories", "cotton-swabs"] },
  "BODY2-N": { aisle: "BODYCARE", sign: "Body care · Soap · Hair · Oral care · Shaving", department: "bodycare", cats: ["toothpaste", "toothbrushes-floss", "deodorant", "body-spray-fragrance"] },
  "BODY2-S": { aisle: "BODYCARE", sign: "Body care · Soap · Hair · Oral care · Shaving", department: "bodycare", cats: ["feminine-care", "razors-shaving", "mens-grooming", "family-planning", "travel-sizes"] },

  // ------------------------------------------------------------ east wall: service counters and cases
  SEAFOOD: { aisle: "SEAFOOD", sign: "Seafood counter", department: "seafood", cats: ["seafood"] },
  "MEAT-COUNTER": { aisle: "MEAT", sign: "Meat · Butcher counter", department: "meat", cats: ["beef", "pork", "turkey-lamb", "halal-meat", "marinated-meat"] },
  "MEAT-CASE": { aisle: "MEAT", sign: "Meat · Butcher counter", department: "meat", cats: ["chicken", "bacon-sausage", "hot-dogs", "plant-protein"] },
  DAIRY: { aisle: "DAIRY", sign: "Dairy · Milk · Eggs · Yogurt · Paneer", department: "dairy", cats: ["milk", "milk-alternatives", "eggs", "yogurt", "butter-margarine", "cream-creamer", "sour-cream-dips", "paneer-indian-dairy", "refrigerated-juice", "kombucha-probiotic", "refrigerated-dough", "pudding-jello", "liquid-egg", "whipped-cream"] },
  "CHEESE-COUNTER": { aisle: "CHEESE", sign: "Cheese & specialty", department: "cheese", cats: ["block-specialty-cheese", "lunch-meat"] },
  "CHEESE-CASE": { aisle: "CHEESE", sign: "Cheese & specialty", department: "cheese", cats: ["shredded-cheese", "dairy-free-cheese", "hummus-dips", "refrigerated-pasta", "lunchables-snack-kits"] },

  // ------------------------------------------------------------ frozen: reach-in doors, then coffins by the food hall
  "FROZEN-A-N": { aisle: "FROZEN", sign: "Frozen · Vegetables · Breakfast · Meals · Ice cream", department: "frozen", cats: ["frozen-vegetables", "frozen-fruit", "frozen-potatoes", "frozen-breakfast", "frozen-bread-dough", "frozen-indian-breads", "frozen-rice-grains"] },
  "FROZEN-A-S": { aisle: "FROZEN", sign: "Frozen · Vegetables · Breakfast · Meals · Ice cream", department: "frozen", cats: ["frozen-pizza", "frozen-dinners", "frozen-bowls-indian", "frozen-appetizers", "frozen-chicken", "frozen-sandwiches", "frozen-pasta-entrees"] },
  "FROZEN-B-N": { aisle: "FROZEN", sign: "Frozen · Vegetables · Breakfast · Meals · Ice cream", department: "frozen", cats: ["frozen-seafood", "frozen-meat", "frozen-veggie-protein", "frozen-turkey-ham", "frozen-international"] },
  "FROZEN-B-S": { aisle: "FROZEN", sign: "Frozen · Vegetables · Breakfast · Meals · Ice cream", department: "frozen", cats: ["ice-cream", "ice-cream-bars", "sherbet-sorbet", "frozen-desserts", "frozen-fruit-bars", "ice"] },

  // ------------------------------------------------------------ south band: café, food hall, bakery
  CAFE: { aisle: "CAFE", sign: "Café · Coffee · Juice · Smoothies", department: "cafe", cats: ["cafe-coffee", "cafe-juice"] },
  HOTBAR: { aisle: "HOTBAR", sign: "Food hall · Hot bar", department: "hotbar", cats: ["hot-bar"] },
  SALADBAR: { aisle: "SALADBAR", sign: "Food hall · Salad bar", department: "saladbar", cats: ["salad-bar"] },
  SOUPS: { aisle: "SOUPS", sign: "Food hall · Soups", department: "soups", cats: ["soups"] },
  ROTISSERIE: { aisle: "ROTISSERIE", sign: "Food hall · Rotisserie", department: "rotisserie", cats: ["rotisserie"] },
  SUSHI: { aisle: "SUSHI", sign: "Food hall · Sushi", department: "sushi", cats: ["sushi"] },
  PIZZA: { aisle: "PIZZA", sign: "Food hall · Pizza", department: "pizza", cats: ["pizza"] },
  DELI: { aisle: "DELI", sign: "Food hall · Deli", department: "deli", cats: ["deli-meat", "deli-cheese", "prepared-salads", "party-trays"] },
  "BREAD-N": { aisle: "BAKERY", sign: "Bakery · Bread · Cakes · Pastries", department: "bakery", cats: ["sandwich-bread", "buns-rolls", "bagels-english-muffins", "gluten-free-bread", "packaged-pastries"] },
  "BREAD-S": { aisle: "BAKERY", sign: "Bakery · Bread · Cakes · Pastries", department: "bakery", cats: ["fresh-bread", "international-breads", "pita-naan-flatbread"] },
  "BAKERY-CASE": { aisle: "BAKERY", sign: "Bakery · Bread · Cakes · Pastries", department: "bakery", cats: ["cakes-cupcakes", "donuts-pastries", "cookies-bakery", "pies-desserts"] },
};

/**
 * Grosher's own catalog rows: what Grosher sells that the carried-over catalog has no row for (bulk,
 * flowers, cookware, the food hall, the café), plus fresh green chilies, which the carried catalog only has
 * canned, and papad, which it only has as an alias of a namkeen row. Placed by category id; they come first, so their names win an exact tie. Bulk is scooped by the
 * bag, so none of it is "heavy" (that tag pulls a stop to the front of the route).
 */
export const GROSHER_ITEMS: (Omit<Stop, "locationIds"> & { categories: string[] })[] = [
  { id: "g-green-chilies", name: "Green chilies", categories: ["tomatoes-peppers"], tags: ["produce"], aliases: ["green chillies", "hari mirch", "fresh green chilies", "thai green chilies"] },
  { id: "g-papad", name: "Papad", categories: ["papad"], tags: ["fragile"], aliases: ["papadum", "pappadam", "appalam", "lijjat papad"] },
  { id: "g-bulk-toor-dal", name: "Bulk toor dal", categories: ["bulk-pulses"], aliases: ["toor dal bulk", "bulk arhar dal", "bulk tuvar dal"] },
  { id: "g-bulk-moong-dal", name: "Bulk moong dal", categories: ["bulk-pulses"], aliases: ["moong dal bulk"] },
  { id: "g-bulk-masoor-dal", name: "Bulk masoor dal", categories: ["bulk-pulses"], aliases: ["masoor dal bulk", "bulk red lentils"] },
  { id: "g-bulk-chana-dal", name: "Bulk chana dal", categories: ["bulk-pulses"], aliases: ["chana dal bulk"] },
  { id: "g-bulk-rajma", name: "Bulk rajma", categories: ["bulk-pulses"], aliases: ["rajma bulk", "bulk kidney beans"] },
  { id: "g-bulk-basmati", name: "Bulk basmati rice", categories: ["bulk-rice-grains"], aliases: ["basmati rice bulk"] },
  { id: "g-bulk-quinoa", name: "Bulk quinoa", categories: ["bulk-rice-grains"] },
  { id: "g-bulk-oats", name: "Bulk rolled oats", categories: ["bulk-rice-grains"], aliases: ["bulk oats"] },
  { id: "g-bulk-atta", name: "Bulk whole wheat atta", categories: ["bulk-flours"], aliases: ["bulk atta", "atta bulk"] },
  { id: "g-bulk-almonds", name: "Bulk almonds", categories: ["bulk-nuts-seeds"] },
  { id: "g-bulk-cashews", name: "Bulk cashews", categories: ["bulk-nuts-seeds"] },
  { id: "g-bulk-raisins", name: "Bulk raisins", categories: ["bulk-dried-fruit"] },
  { id: "g-bulk-dates", name: "Bulk medjool dates", categories: ["bulk-dried-fruit"], aliases: ["bulk dates"] },
  { id: "g-bouquet", name: "Flower bouquet", categories: ["bouquets"], tags: ["fragile"], aliases: ["bouquet", "flowers", "mixed bouquet"] },
  { id: "g-roses", name: "Roses", categories: ["bouquets"], tags: ["fragile"], aliases: ["dozen roses", "red roses"] },
  { id: "g-tulips", name: "Tulips", categories: ["bouquets"], tags: ["fragile"] },
  { id: "g-orchid", name: "Orchid plant", categories: ["plants"], tags: ["fragile"], aliases: ["orchid", "potted orchid"] },
  { id: "g-succulent", name: "Succulent", categories: ["plants"], tags: ["fragile"] },
  { id: "g-frying-pan", name: "Frying pan", categories: ["cookware"], tags: ["heavy"], aliases: ["fry pan", "nonstick frying pan"] },
  { id: "g-saucepan", name: "Saucepan", categories: ["cookware"], tags: ["heavy"] },
  { id: "g-sheet-pan", name: "Sheet pan", categories: ["cookware"], aliases: ["baking sheet"] },
  { id: "g-spatula", name: "Spatula", categories: ["kitchen-utensils"], aliases: ["turner"] },
  { id: "g-whisk", name: "Whisk", categories: ["kitchen-utensils"] },
  { id: "g-cutting-board", name: "Cutting board", categories: ["kitchen-utensils"], aliases: ["chopping board"] },
  { id: "g-chef-knife", name: "Chef's knife", categories: ["kitchen-utensils"], aliases: ["kitchen knife", "chef knife"] },
  { id: "g-sushi-platter", name: "Sushi platter", categories: ["sushi"], tags: ["fragile"], aliases: ["sushi party platter", "sushi tray"] },
  { id: "g-california-roll", name: "California roll", categories: ["sushi"] },
  { id: "g-hot-bar-box", name: "Hot bar box", categories: ["hot-bar"], aliases: ["hot bar container", "hot bar meal"] },
  { id: "g-butter-chicken-hot", name: "Butter chicken (hot bar)", categories: ["hot-bar"], aliases: ["hot bar butter chicken"] },
  { id: "g-chicken-soup-hot", name: "Chicken soup (hot bar)", categories: ["soups"], aliases: ["hot chicken soup", "chicken soup from the soup bar"] },
  { id: "g-tomato-soup-hot", name: "Tomato bisque (soup bar)", categories: ["soups"], aliases: ["hot tomato soup"] },
  { id: "g-salad-bar", name: "Salad bar salad", categories: ["salad-bar"], aliases: ["salad bar bowl"] },
  { id: "g-pizza-slice", name: "Pizza slice", categories: ["pizza"], aliases: ["slice of pizza"] },
  { id: "g-whole-pizza", name: "Whole pizza", categories: ["pizza"], aliases: ["fresh baked pizza", "cheese pizza whole"] },
  { id: "g-latte", name: "Latte", categories: ["cafe-coffee"], aliases: ["cafe latte", "oat milk latte"] },
  { id: "g-cappuccino", name: "Cappuccino", categories: ["cafe-coffee"] },
  { id: "g-smoothie", name: "Smoothie", categories: ["cafe-juice"], aliases: ["fruit smoothie", "berry smoothie"] },
  { id: "g-fresh-oj", name: "Fresh-squeezed orange juice", categories: ["cafe-juice"], aliases: ["fresh orange juice", "fresh squeezed oj"] },
  { id: "g-wine-tasting", name: "Wine flight", categories: ["wine-bar"], aliases: ["wine tasting flight"] },
];

/**
 * Re-homing the carried catalog: rows the Walmart taxonomy had to put somewhere wrong because it had no shelf
 * for them (Instacart's beer, wine and spirits aisles all landed on the bar mixers; its flowers among the
 * batteries; prepared sushi in the deli's party trays). A row moves only when it sits in `from` and its name
 * matches; the first rule that matches wins. The words are the product's own, never a guess at storage.
 */
export const REHOME: { from: string[]; to: string; match: RegExp; not?: RegExp }[] = [
  { from: ["mixers"], to: "sparkling-wine", match: /\b(champagne|prosecco|cava|brut|sparkling|spumante|cremant|crémant|blanc de noirs|blanc de blancs|lambrusco|asti)\b/i, not: /\b(cider|juice|soda|water|lemonade|kombucha)\b/i },
  { from: ["mixers"], to: "cider-seltzer", match: /\b(hard cider|cider|hard seltzer|spiked seltzer|hard lemonade|cooler)\b/i },
  { from: ["mixers"], to: "beer", match: /\b(beer|beers|ale|ales|lager|ipa|iipa|dipa|stout|porter|pilsner|pils|hefeweizen|weiss|weizen|witbier|saison|bock|kolsch|kölsch|gose|shandy|brew|draft|oktoberfest|malt beverage|malt liquor|budweiser|pabst|coors|miller|corona|heineken|modelo|sculpin)\b/i, not: /\b(ginger beer|root beer|birch beer|ginger ale|alcoholic ginger beer)\b/i },
  { from: ["mixers"], to: "spirits", match: /\b(vodka|whiskey|whisky|bourbon|tequila|rums?|gin|scotch|brandy|cognac|liqueur|liquer|liquor|mezcal|schnapps|vermouth|amaretto|sake|saké|soju|absinthe|stoli|smirnoff|bacardi|kahlua|baileys)\b/i, not: /\b(mix|mixer|syrup|malt liquor)\b/i },
  { from: ["mixers"], to: "white-wine", match: /\b(white wine|white|blanc|chardonnay|sauvignon blanc|pinot grigio|pinot gris|riesling|moscato|rose|rosé|viognier|chenin|gewurztraminer|gerwurztraminer|albarino|vinho verde|sauternes|sherry|marsala|madeira)\b/i },
  { from: ["mixers"], to: "red-wine", match: /\b(red wine|red|red blend|cabernet|carbernet|merlot|pinot noir|malbec|zinfandel|zin|syrah|shiraz|sangiovese|tempranillo|chianti|rioja|bordeaux|grenache|petite sirah|carmenere|beaujolais|barbera|claret|sangria|port|wine)\b/i },
  { from: ["batteries-lightbulbs"], to: "bouquets", match: /\b(roses|tulips|bouquet|lilies|sunflowers|carnations|daisies|hydrangea|peonies|flowers)\b/i, not: /\bgarnish/i },
  { from: ["batteries-lightbulbs"], to: "plants", match: /\b(orchid|succulent|potted|plant)\b/i, not: /\b(food|plant based)\b/i },
  { from: ["party-trays", "prepared-salads", "asian-noodles-rice"], to: "sushi", match: /\b(sushi|california roll|tuna roll|salmon roll|roll special|sashimi|nigiri)\b/i, not: /\b(nori|rice|ginger|wasabi|mat|vinegar|soy sauce|panko|mirin|flakes)\b/i },
  { from: ["rotisserie"], to: "soups", match: /\bsoup\b/i },
  { from: ["prepared-salads", "party-trays"], to: "salad-bar", match: /\bsalad bar\b/i },
  { from: ["indian-snacks"], to: "papad", match: /\b(papad|papadum|pappadam|poppadom|appalam)\b/i },
  { from: ["food-storage", "storage-containers", "disposable-plates", "sponges-gloves"], to: "cookware", match: /\b(skillet|frying pan|fry pan|saucepan|sauce pan|stockpot|baking sheet|cake pan|muffin pan|loaf pan|roasting pan|casserole dish|dutch oven)\b/i },
  { from: ["food-storage", "storage-containers", "disposable-plates", "sponges-gloves"], to: "kitchen-utensils", match: /\b(spatula|whisk|tongs|ladle|peeler|can opener|measuring cups?|measuring spoons?|cutting board|chopping board|colander|grater|rolling pin|bamboo mat)\b/i },
];

/** The hero demo lists, as a person would jot them (design/store-grosher.md). Never reordered. */
export const HERO_LISTS: { id: string; name: string; items: string[] }[] = [
  { id: "dal-chawal", name: "Weeknight dal-chawal", items: ["toor dal (bulk)", "basmati rice", "ghee", "onions", "tomatoes", "cilantro", "green chilies", "yogurt", "paneer", "atta"] },
  { id: "weekly-staples", name: "Weekly staples", items: ["milk", "eggs", "bread", "bananas", "spinach", "chicken", "cereal", "coffee", "paper towels", "dish soap", "frozen peas"] },
  { id: "friday-night", name: "Friday night in", items: ["chips", "salsa", "sushi platter", "red wine", "cheese", "crackers", "ice cream", "sparkling water", "flowers"] },
  { id: "pharmacy-run", name: "Quick pharmacy run", items: ["cold & flu medicine", "tissues", "orange juice", "chicken soup (hot bar)", "throat lozenges"] },
];
