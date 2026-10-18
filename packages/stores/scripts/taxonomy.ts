// The demo Supercenter's shelf taxonomy, the way Walmart aisle signs read.
// One entry per aisle (or wall), each with its sign, its department and the
// categories along it in order from the entrance-facing end (bay 1), left
// side first then right. gen-demo.ts turns this into categories.json and
// the shelf locations; the seed script fills each category with products.
//
// Aliases are what a shopper types that means the category itself ("tp",
// "atta"); product names come from the seed. Tags are handling defaults.

import type { ItemTag } from "@grosher/core";

export interface TaxCategory {
  id: string;
  name: string;
  aliases?: string[];
  tags?: ItemTag[];
}

export interface TaxAisle {
  /** "A7", or a wall id: PRODUCE, DAIRY, MEAT, DELI, BAKERY, PHARMACY */
  aisle: string;
  /** the sign over the aisle */
  sign: string;
  department: string;
  /** categories on the left side, bay 1 outward */
  left: TaxCategory[];
  /** categories on the right side; walls have one side only */
  right?: TaxCategory[];
}

const c = (id: string, name: string, aliases: string[] = [], tags?: ItemTag[]): TaxCategory => (tags ? { id, name, aliases, tags } : { id, name, aliases });

export const TAXONOMY: TaxAisle[] = [
  // ---------------------------------------------------------------- walls
  {
    aisle: "PRODUCE",
    sign: "Produce · Fresh fruit · Vegetables",
    department: "produce",
    left: [
      c("bananas", "Bananas", ["banana"], ["produce"]),
      c("apples-pears", "Apples & pears", ["apples", "pears"], ["produce"]),
      c("citrus", "Citrus", ["oranges", "lemons", "limes", "grapefruit"], ["produce"]),
      c("berries", "Berries", ["strawberries", "blueberries", "raspberries"], ["produce", "fragile"]),
      c("grapes-melons", "Grapes & melons", ["grapes", "watermelon", "cantaloupe"], ["produce", "heavy"]),
      c("tropical-fruit", "Tropical fruit", ["mango", "pineapple", "papaya", "avocados"], ["produce"]),
      c("salad-greens", "Salads & greens", ["lettuce", "spinach", "salad kit", "kale", "arugula"], ["produce"]),
      c("tomatoes-peppers", "Tomatoes & peppers", ["tomato", "bell pepper", "jalapeno", "chili peppers"], ["produce"]),
      c("onions-garlic", "Onions, garlic & ginger", ["onion", "garlic", "ginger", "shallots"], ["produce"]),
      c("potatoes-roots", "Potatoes & root vegetables", ["potato", "sweet potato", "carrots", "beets"], ["produce", "heavy"]),
      c("cooking-vegetables", "Cooking vegetables", ["broccoli", "cauliflower", "zucchini", "squash", "green beans", "okra", "eggplant"], ["produce"]),
      c("fresh-herbs", "Fresh herbs", ["cilantro", "coriander leaves", "mint", "curry leaves", "parsley", "basil"], ["produce", "fragile"]),
      c("mushrooms-sprouts", "Mushrooms & sprouts", ["mushroom", "bean sprouts"], ["produce"]),
      c("cut-fruit-juice", "Cut fruit & fresh juice", ["fruit cup", "cold pressed juice"], ["chilled", "fragile"]),
      // cut produce is refrigerated (food safety), like the cut fruit beside it
      c("cut-vegetables", "Cut vegetables & stir-fry mixes", ["baby carrots", "celery sticks", "stir fry mix", "coleslaw mix", "riced cauliflower fresh"], ["produce", "chilled"]),
    ],
  },
  {
    aisle: "DAIRY",
    sign: "Dairy · Milk · Eggs · Yogurt",
    department: "dairy",
    left: [
      c("milk", "Milk", ["whole milk", "2 percent milk", "skim milk", "gallon of milk"], ["chilled", "heavy"]),
      c("milk-alternatives", "Milk alternatives", ["oat milk", "almond milk", "soy milk", "plant milk"], ["chilled"]),
      c("eggs", "Eggs", ["egg", "dozen eggs"], ["chilled", "fragile"]),
      c("yogurt", "Yogurt", ["yoghurt", "greek yogurt", "curd", "dahi"], ["chilled"]),
      c("butter-margarine", "Butter & margarine", ["butter", "margarine"], ["chilled"]),
      c("cream-creamer", "Cream & creamer", ["heavy cream", "half and half", "coffee creamer", "whipping cream"], ["chilled"]),
      c("sour-cream-dips", "Sour cream & cottage cheese", ["sour cream", "cottage cheese"], ["chilled"]),
      c("refrigerated-juice", "Refrigerated juice", ["orange juice", "oj", "lemonade"], ["chilled", "heavy"]),
      c("refrigerated-dough", "Refrigerated dough", ["biscuits in a can", "crescent rolls", "pie crust", "cookie dough"], ["chilled"]),
      c("pudding-jello", "Pudding & gelatin cups", ["pudding", "jello"], ["chilled"]),
      c("liquid-egg", "Liquid egg & egg substitutes", ["egg whites", "just egg", "egg beaters"], ["chilled"]),
      c("whipped-cream", "Whipped cream & dairy desserts", ["reddi wip", "whipped cream can", "cheesecake cups"], ["chilled"]),
    ],
  },
  {
    aisle: "MEAT",
    sign: "Meat · Seafood",
    department: "meat",
    left: [
      c("chicken", "Chicken", ["chicken breast", "chicken thighs", "whole chicken", "drumsticks", "wings"], ["chilled"]),
      c("beef", "Beef", ["ground beef", "steak", "stew meat", "ribeye"], ["chilled"]),
      c("pork", "Pork", ["pork chops", "pork loin", "ribs", "ground pork"], ["chilled"]),
      c("turkey-lamb", "Turkey & lamb", ["ground turkey", "turkey", "lamb", "goat meat", "mutton"], ["chilled"]),
      c("bacon-sausage", "Bacon & sausage", ["bacon", "sausage", "breakfast sausage", "chorizo"], ["chilled"]),
      c("hot-dogs", "Hot dogs & franks", ["hot dogs", "franks", "wieners"], ["chilled"]),
      c("seafood", "Fresh seafood", ["fish", "salmon", "tilapia", "shrimp", "cod", "catfish"], ["chilled", "fragile"]),
      c("plant-protein", "Plant-based protein & tofu", ["tofu", "tempeh", "plant based meat", "beyond meat"], ["chilled"]),
      c("marinated-meat", "Marinated & ready to cook", ["marinated chicken", "kebabs", "fajita meat"], ["chilled"]),
      c("halal-meat", "Halal meat", ["halal chicken", "halal goat", "halal beef", "zabiha"], ["chilled"]),
    ],
  },
  {
    aisle: "DELI",
    sign: "Deli · Rotisserie · Prepared",
    department: "deli",
    left: [
      // the deli's hot case: picked late like cold food, so it is still hot at the till
      c("rotisserie", "Rotisserie chicken & hot food", ["rotisserie chicken", "hot chicken", "fried chicken"], ["hot"]),
      c("deli-meat", "Sliced deli meat", ["turkey slices", "ham slices", "salami", "lunch meat"], ["chilled"]),
      c("deli-cheese", "Deli cheese", ["sliced cheese", "cheese block from deli"], ["chilled"]),
      c("prepared-salads", "Prepared salads & sides", ["potato salad", "coleslaw", "macaroni salad"], ["chilled"]),
      c("party-trays", "Party trays & sandwiches", ["sub sandwich", "veggie tray", "fruit tray", "sandwich"], ["chilled", "fragile"]),
    ],
  },
  {
    aisle: "BAKERY",
    sign: "Bakery · Fresh bread · Cakes",
    department: "bakery",
    left: [
      c("fresh-bread", "Fresh bread & rolls", ["french bread", "baguette", "sourdough", "dinner rolls", "naan from bakery"], ["fragile"]),
      c("cakes-cupcakes", "Cakes & cupcakes", ["birthday cake", "cake", "cupcakes", "sheet cake"], ["fragile"]),
      c("donuts-pastries", "Donuts & pastries", ["donuts", "doughnuts", "croissants", "danish", "muffins"], ["fragile"]),
      c("cookies-bakery", "Bakery cookies & brownies", ["bakery cookies", "brownies"], ["fragile"]),
      c("pies-desserts", "Pies & desserts", ["apple pie", "pumpkin pie", "cheesecake"], ["fragile"]),
      c("international-breads", "International breads", ["pan dulce", "conchas", "bolillo", "challah", "brioche"], ["fragile"]),
    ],
  },
  {
    aisle: "PHARMACY",
    sign: "Pharmacy · Cold & flu · Allergy",
    department: "pharmacy",
    left: [
      c("pharmacy-counter", "Pharmacy counter", ["prescription", "rx", "pickup prescription", "flu shot"]),
      c("cold-flu", "Cold, cough & flu", ["cough syrup", "dayquil", "nyquil", "cough drops", "cold medicine"]),
      c("allergy-sinus", "Allergy & sinus", ["allergy medicine", "zyrtec", "claritin", "antihistamine", "nasal spray"]),
      c("digestive", "Digestive & antacids", ["tums", "pepto", "antacid", "laxative", "probiotics"]),
      c("eye-ear-care", "Eye & ear care", ["eye drops", "contact solution", "ear drops"]),
    ],
  },
  // ---------------------------------------------------------------- grocery aisles
  {
    aisle: "A1",
    sign: "Bread · Tortillas · Buns",
    department: "dry",
    left: [
      c("sandwich-bread", "Sandwich bread", ["bread", "white bread", "wheat bread", "loaf of bread"], ["fragile"]),
      c("buns-rolls", "Buns & rolls", ["hamburger buns", "hot dog buns", "dinner rolls"], ["fragile"]),
      c("bagels-english-muffins", "Bagels & English muffins", ["bagels", "english muffins"], ["fragile"]),
      c("tortillas-wraps", "Tortillas & wraps", ["tortillas", "flour tortillas", "corn tortillas", "wraps"], ["fragile"]),
      c("pita-naan-flatbread", "Pita, naan & flatbread", ["naan", "pita", "flatbread", "roti", "chapati"], ["fragile"]),
    ],
    right: [
      c("croutons-breadcrumbs", "Croutons & bread crumbs", ["breadcrumbs", "panko", "croutons", "stuffing"]),
      c("packaged-pastries", "Packaged pastries & snack cakes", ["honey buns", "little debbie"]),
      c("rice-cakes", "Rice cakes & crispbread", ["rice cakes", "crispbread"]),
      c("gluten-free-bread", "Gluten-free bread & keto", ["gluten free bread", "keto bread", "low carb tortillas"], ["fragile"]),
    ],
  },
  {
    aisle: "A2",
    sign: "Peanut butter · Jelly · Honey",
    department: "dry",
    left: [
      c("peanut-butter", "Peanut butter & nut butters", ["peanut butter", "pb", "almond butter", "jif", "skippy"]),
      c("jelly-jam", "Jelly, jam & preserves", ["jelly", "jam", "preserves", "fruit spread"], ["fragile"]),
      c("honey-syrup", "Honey & syrup", ["honey", "maple syrup", "pancake syrup", "agave"], ["fragile"]),
      c("hazelnut-spread", "Chocolate & hazelnut spreads", ["nutella", "hazelnut spread"]),
    ],
    right: [
      c("pancake-waffle-mix", "Pancake & waffle mix", ["pancake mix", "bisquick", "waffle mix"]),
      c("hot-cereal", "Oatmeal & hot cereal", ["oatmeal", "oats", "rolled oats", "quaker", "grits", "cream of wheat"]),
      c("granola", "Granola & muesli", ["granola", "muesli"]),
      c("breakfast-bars", "Breakfast & granola bars", ["granola bars", "cereal bars", "nature valley", "breakfast bars"]),
      c("dessert-toppings", "Dessert syrups & toppings", ["chocolate syrup", "caramel sauce", "hersheys syrup", "ice cream topping"], ["fragile"]),
    ],
  },
  {
    aisle: "A3",
    sign: "Condiments · Dressings · Pickles",
    department: "dry",
    left: [
      c("ketchup-mustard", "Ketchup & mustard", ["ketchup", "mustard", "heinz"], ["fragile"]),
      c("mayo", "Mayonnaise & sandwich spreads", ["mayo", "mayonnaise", "miracle whip", "hellmans"]),
      c("bbq-sauce", "BBQ & steak sauce", ["bbq sauce", "barbecue sauce", "steak sauce", "a1"], ["fragile"]),
      c("hot-sauce", "Hot sauce & salsa", ["hot sauce", "sriracha", "tabasco", "salsa", "chili garlic sauce"], ["fragile"]),
      c("salad-dressing", "Salad dressing", ["ranch", "dressing", "italian dressing", "vinaigrette"], ["fragile"]),
    ],
    right: [
      c("pickles-olives", "Pickles, olives & peppers", ["pickles", "olives", "pepperoncini", "relish"], ["fragile"]),
      c("vinegar", "Vinegar", ["vinegar", "apple cider vinegar", "balsamic", "white vinegar"], ["fragile"]),
      c("marinades-sauces", "Marinades, soy & worcestershire", ["soy sauce", "worcestershire", "marinade", "teriyaki", "fish sauce"], ["fragile"]),
      c("gravy-mixes", "Gravy & sauce mixes", ["gravy mix", "taco seasoning packet", "sauce packet"]),
    ],
  },
  {
    aisle: "A4",
    sign: "Canned vegetables · Fruit · Soup",
    department: "dry",
    left: [
      c("canned-vegetables", "Canned vegetables", ["canned corn", "canned green beans", "canned peas", "canned vegetables"], ["heavy"]),
      c("canned-tomatoes", "Canned tomatoes & paste", ["canned tomatoes", "tomato paste", "tomato sauce", "diced tomatoes", "crushed tomatoes"], ["heavy"]),
      c("canned-beans", "Canned beans", ["canned beans", "black beans", "chickpeas", "garbanzo", "kidney beans", "refried beans"], ["heavy"]),
      c("canned-fruit", "Canned fruit & applesauce", ["canned fruit", "peaches in syrup", "applesauce", "fruit cups"], ["heavy"]),
    ],
    right: [
      c("soup", "Canned soup", ["soup", "campbells", "chicken noodle soup", "tomato soup", "progresso"], ["heavy"]),
      c("broth-stock", "Broth, stock & bouillon", ["chicken broth", "stock", "bouillon", "bone broth"], ["heavy"]),
      c("ramen-instant", "Ramen & instant noodles", ["ramen", "instant noodles", "cup noodles", "maggi"]),
      c("canned-meat-fish", "Canned tuna, chicken & meat", ["tuna", "canned chicken", "spam", "sardines", "canned salmon"]),
      c("chili-canned-meals", "Chili & canned meals", ["chili", "ravioli in a can", "spaghettios", "beef stew"], ["heavy"]),
    ],
  },
  {
    aisle: "A5",
    sign: "Pasta · Sauce · Rice · Beans",
    department: "dry",
    left: [
      c("pasta", "Pasta", ["spaghetti", "penne", "macaroni", "noodles", "barilla", "lasagna noodles"]),
      c("pasta-sauce", "Pasta sauce", ["marinara", "spaghetti sauce", "alfredo", "ragu", "prego"], ["fragile", "heavy"]),
      c("mac-and-cheese", "Mac & cheese & pasta kits", ["mac and cheese", "kraft mac", "hamburger helper", "velveeta shells"]),
      c("rice", "Rice", ["white rice", "jasmine rice", "brown rice", "long grain rice", "rice bag"], ["heavy"]),
    ],
    right: [
      c("rice-mixes", "Rice & grain mixes", ["rice a roni", "rice mix", "quinoa", "couscous", "instant rice"]),
      c("dried-beans-lentils", "Dried beans, peas & lentils", ["dried beans", "lentils", "split peas", "pinto beans bag"], ["heavy"]),
      c("boxed-meals-potatoes", "Boxed dinners & instant potatoes", ["instant mashed potatoes", "stuffing mix", "boxed dinner"]),
      c("gluten-free-pasta", "Gluten-free & specialty pasta", ["gluten free pasta", "chickpea pasta", "lentil pasta"]),
    ],
  },
  {
    aisle: "A6",
    sign: "Hispanic foods · Latin",
    department: "dry",
    left: [
      c("salsa-taco", "Taco shells, salsa & taco kits", ["taco shells", "taco kit", "tostadas", "old el paso"]),
      c("hispanic-beans-rice", "Hispanic beans, rice & masa", ["masa", "maseca", "goya beans", "mexican rice"], ["heavy"]),
      c("mexican-sauces", "Mole, enchilada & hot sauces", ["enchilada sauce", "mole", "valentina", "tajin", "chamoy"], ["fragile"]),
      c("hispanic-spices", "Hispanic seasonings & chiles", ["adobo", "sazon", "dried chiles", "guajillo", "chipotle in adobo"]),
    ],
    right: [
      c("hispanic-drinks", "Hispanic drinks & aguas", ["horchata", "jarritos", "tamarindo drink", "abuelita chocolate", "nescafe clasico"], ["heavy"]),
      c("hispanic-snacks-sweets", "Hispanic snacks & sweets", ["takis", "dulce de leche", "cajeta", "mexican candy", "marias cookies"]),
      c("hispanic-cooking", "Hispanic cooking staples", ["lard", "manteca", "tamale husks", "crema"]),
      c("hispanic-tortillas", "Hispanic tortillas & tostadas", ["corn tortillas 80 count", "tostadas", "mission tortillas"], ["fragile"]),
    ],
  },
  {
    aisle: "A7",
    sign: "Asian · Indian · Mediterranean",
    department: "dry",
    left: [
      c("atta-flours", "Atta & Indian flours", ["atta", "chapati flour", "aashirvaad", "besan", "gram flour", "sooji", "rava", "maida"], ["heavy"]),
      c("basmati-indian-rice", "Basmati & Indian rice", ["basmati", "basmati rice", "sona masoori", "idli rice", "poha", "flattened rice", "royal basmati"], ["heavy"]),
      c("dal-lentils", "Dal & pulses", ["dal", "daal", "toor dal", "moong dal", "chana dal", "urad dal", "masoor dal", "rajma", "chana", "kabuli chana"], ["heavy"]),
      c("indian-spices", "Indian spices & masalas", ["garam masala", "turmeric", "haldi", "jeera", "cumin seeds", "coriander powder", "dhania", "red chili powder", "mdh", "everest", "hing", "asafoetida", "methi"]),
      c("ghee-oils-indian", "Ghee & Indian cooking oils", ["ghee", "desi ghee", "mustard oil"], ["fragile", "heavy"]),
      c("indian-pickles-chutney", "Indian pickles, chutney & pastes", ["achar", "mango pickle", "lime pickle", "chutney", "ginger garlic paste", "tamarind", "imli"], ["fragile"]),
      c("indian-snacks", "Indian snacks & namkeen", ["haldirams", "namkeen", "bhujia", "chakli", "papad", "khakhra", "mixture"]),
      c("indian-ready-meals", "Indian ready meals & mixes", ["mtr", "ready to eat curry", "dosa mix", "idli mix", "gulab jamun mix", "parle g"]),
      c("indian-tea-drinks", "Indian tea & drinks", ["chai", "taj mahal tea", "red label", "wagh bakri", "rooh afza", "horlicks", "bournvita"]),
      c("indian-masala-blends", "Masala blends & curry mixes", ["chana masala", "pav bhaji masala", "sambar powder", "rasam powder", "biryani masala", "shan masala", "curry powder"]),
    ],
    right: [
      c("asian-noodles-rice", "Asian noodles & rice", ["rice noodles", "udon", "soba", "pad thai noodles", "sushi rice", "glass noodles"]),
      c("asian-sauces", "Asian sauces & pastes", ["oyster sauce", "hoisin", "gochujang", "miso", "curry paste", "sesame oil", "rice vinegar"], ["fragile"]),
      c("coconut-milk-curry", "Coconut milk & curry", ["coconut milk", "coconut cream", "thai curry", "panang"]),
      c("seaweed-asian-snacks", "Seaweed & Asian snacks", ["seaweed snacks", "nori", "pocky", "shrimp chips", "mochi"]),
      c("mediterranean", "Mediterranean & Middle Eastern", ["tahini", "hummus mix", "falafel mix", "grape leaves", "harissa", "halal"]),
      c("kosher", "Kosher foods", ["matzo", "kosher", "gefilte fish"]),
      c("asian-rice-bags", "Asian rice bags", ["jasmine rice 25 lb", "calrose", "sushi rice bag", "thai rice", "sticky rice"], ["heavy"]),
      c("asian-chili-condiments", "Chili crisp, sambal & Asian condiments", ["chili crisp", "lao gan ma", "sambal oelek", "chili oil", "ponzu"], ["fragile"]),
      c("asian-instant-noodles", "Asian instant noodles", ["shin ramyun", "indomie", "buldak", "nongshim", "mama noodles"]),
    ],
  },
  {
    aisle: "A8",
    sign: "Baking · Flour · Sugar · Oils",
    department: "dry",
    left: [
      c("flour", "Flour", ["all purpose flour", "bread flour", "self rising flour", "whole wheat flour", "cornmeal"], ["heavy"]),
      c("sugar", "Sugar & sweeteners", ["sugar", "brown sugar", "powdered sugar", "stevia", "splenda", "jaggery"], ["heavy"]),
      c("baking-mixes", "Cake, brownie & cookie mixes", ["cake mix", "brownie mix", "cookie mix", "betty crocker", "muffin mix", "cornbread mix"]),
      c("frosting-decorating", "Frosting & decorating", ["frosting", "sprinkles", "food coloring", "icing"]),
      c("baking-essentials", "Baking soda, powder, yeast & extracts", ["baking soda", "baking powder", "yeast", "vanilla extract", "cornstarch", "cocoa powder"]),
      c("specialty-flours", "Specialty & gluten-free flours", ["almond flour", "gluten free flour", "coconut flour", "oat flour", "king arthur"], ["heavy"]),
    ],
    right: [
      c("cooking-oil", "Cooking oil", ["vegetable oil", "canola oil", "olive oil", "evoo", "avocado oil", "cooking spray", "pam"], ["heavy", "fragile"]),
      c("baking-chips-nuts", "Chocolate chips & baking nuts", ["chocolate chips", "walnuts for baking", "pecans", "coconut flakes"]),
      c("evaporated-condensed", "Evaporated & condensed milk", ["condensed milk", "evaporated milk", "dulce de leche can", "cream of coconut"]),
      c("pie-filling-pudding", "Pie filling, pudding & gelatin mix", ["pie filling", "pudding mix", "jello mix", "pumpkin puree"]),
      c("shortening-lard", "Shortening & lard", ["crisco", "shortening"]),
    ],
  },
  {
    aisle: "A9",
    sign: "Spices · Seasonings · Salt",
    department: "dry",
    left: [
      c("spices-herbs", "Spices & dried herbs", ["spices", "cumin", "paprika", "oregano", "cinnamon", "black pepper", "mccormick", "cayenne", "bay leaves"]),
      c("seasoning-blends", "Seasoning blends & rubs", ["seasoning", "italian seasoning", "taco seasoning", "cajun seasoning", "lemon pepper", "everything bagel seasoning"]),
      c("salt", "Salt", ["salt", "kosher salt", "sea salt", "table salt", "pink salt"]),
      c("bouillon-cubes", "Bouillon cubes & soup base", ["bouillon cubes", "knorr", "better than bouillon", "maggi cubes"]),
    ],
    right: [
      c("gravy-dry-mixes", "Gravy & dip mixes", ["gravy packet", "ranch dip mix", "onion soup mix"]),
      c("food-coloring-extract", "Extracts & food coloring", ["almond extract", "lemon extract"]),
      c("breading-coating", "Breading & coating mixes", ["shake n bake", "breading", "batter mix", "fish fry"]),
      c("lemon-lime-juice", "Bottled lemon & lime juice", ["lemon juice", "lime juice"], ["fragile"]),
    ],
  },
  {
    aisle: "A10",
    sign: "Cereal · Breakfast",
    department: "dry",
    left: [
      c("cereal", "Cereal", ["cheerios", "corn flakes", "frosted flakes", "lucky charms", "cinnamon toast crunch", "kids cereal", "cereal box"], ["fragile"]),
      c("healthy-cereal", "Healthy & adult cereal", ["raisin bran", "special k", "bran flakes", "shredded wheat", "kashi"], ["fragile"]),
      c("toaster-pastries", "Toaster pastries", ["pop tarts", "toaster strudel pastries"]),
    ],
    right: [
      c("breakfast-drinks", "Breakfast & protein drinks", ["carnation instant breakfast", "protein shake powder", "ensure", "boost", "slimfast"]),
      c("protein-powder", "Protein powder & supplements", ["protein powder", "whey", "creatine", "pre workout"], ["heavy"]),
      c("kids-fruit-snacks", "Kids snacks & fruit snacks", ["fruit snacks", "gushers", "welchs fruit snacks", "kids snack packs"]),
      c("breakfast-biscuits", "Breakfast biscuits & oatmeal cups", ["belvita", "oatmeal cups", "instant oatmeal packets"]),
    ],
  },
  {
    aisle: "A11",
    sign: "Coffee · Tea · Cocoa",
    department: "dry",
    left: [
      c("ground-coffee", "Ground & whole bean coffee", ["coffee", "folgers", "ground coffee", "coffee beans", "dunkin coffee", "starbucks coffee"]),
      c("k-cups", "K-Cups & coffee pods", ["k cups", "keurig pods", "coffee pods", "nespresso pods"]),
      c("instant-coffee", "Instant coffee & espresso", ["instant coffee", "nescafe", "espresso powder", "bru coffee"]),
      c("creamer-shelf", "Shelf-stable creamer & sweetener", ["coffee mate", "powdered creamer", "sweetener packets"]),
    ],
    right: [
      c("tea", "Tea", ["tea bags", "black tea", "green tea", "lipton", "chai tea bags", "herbal tea", "chamomile"]),
      c("hot-cocoa", "Hot cocoa & drink mixes", ["hot chocolate", "hot cocoa", "swiss miss", "ovaltine", "nesquik powder"]),
      c("coffee-filters", "Coffee filters & accessories", ["coffee filters", "coffee maker cleaner"]),
      c("cold-brew", "Cold brew & coffee concentrate", ["cold brew", "coffee concentrate", "iced coffee bottle"], ["heavy"]),
    ],
  },
  // ---------------------------------------------------------------- snacks
  {
    aisle: "A12",
    sign: "Chips · Pretzels · Popcorn",
    department: "snack",
    left: [
      c("potato-chips", "Potato chips", ["chips", "lays", "ruffles", "kettle chips", "pringles", "crisps"], ["fragile"]),
      c("tortilla-chips", "Tortilla chips", ["doritos", "tostitos", "tortilla chips", "corn chips", "fritos"], ["fragile"]),
      c("cheese-puffs", "Cheese puffs & snack mixes", ["cheetos", "chex mix", "snack mix", "funyuns"], ["fragile"]),
      c("pretzels", "Pretzels", ["pretzels", "pretzel sticks", "rold gold"], ["fragile"]),
    ],
    right: [
      c("popcorn", "Popcorn", ["microwave popcorn", "popcorn kernels", "orville", "skinny pop"], ["fragile"]),
      c("veggie-chips", "Veggie, pita & healthier chips", ["veggie straws", "pita chips", "plantain chips", "popchips"], ["fragile"]),
      c("dips-salsa-jar", "Dips, queso & jarred salsa", ["queso", "salsa jar", "french onion dip", "guacamole mix"], ["fragile"]),
    ],
  },
  {
    aisle: "A13",
    sign: "Crackers · Cookies",
    department: "snack",
    left: [
      c("crackers", "Crackers", ["crackers", "ritz", "saltines", "triscuit", "wheat thins", "goldfish"], ["fragile"]),
      c("graham-crackers", "Graham crackers & animal crackers", ["graham crackers", "animal crackers", "teddy grahams"], ["fragile"]),
      c("cookies", "Cookies", ["oreos", "chips ahoy", "cookies", "fig newtons", "nilla wafers", "biscuits"], ["fragile"]),
    ],
    right: [
      c("snack-cakes", "Snack cakes & mini muffins", ["twinkies", "little bites", "hostess", "mini muffins", "snack cakes"]),
      c("fruit-snacks-pouches", "Fruit snacks & applesauce pouches", ["applesauce pouches", "fruit roll ups", "fruit leather"]),
      c("rice-crispy-treats", "Rice crispy treats & wafers", ["rice krispies treats", "wafers", "sugar wafers"], ["fragile"]),
      c("international-biscuits", "International biscuits & cookies", ["digestives", "marie biscuits", "parle g biscuits", "britannia", "lotus biscoff", "leibniz"], ["fragile"]),
    ],
  },
  {
    aisle: "A14",
    sign: "Candy · Gum · Chocolate",
    department: "snack",
    left: [
      c("chocolate-bars", "Chocolate bars & bags", ["chocolate", "hersheys", "snickers", "reeses", "kit kat", "m and ms", "candy bar"]),
      c("gummy-candy", "Gummy & chewy candy", ["gummy bears", "haribo", "skittles", "starburst", "sour patch", "twizzlers"]),
      c("hard-candy-mints", "Hard candy & mints", ["lollipops", "jolly ranchers", "werthers", "mints", "altoids", "tic tacs"]),
      c("gum", "Gum", ["gum", "chewing gum", "trident", "orbit", "extra gum"]),
    ],
    right: [
      c("seasonal-candy", "Seasonal & bagged candy", ["halloween candy", "candy bags", "bulk candy", "fun size"]),
      c("premium-chocolate", "Premium & dark chocolate", ["lindt", "ghirardelli", "dark chocolate", "ferrero rocher"]),
      c("indian-sweets-shelf", "Indian & international sweets", ["soan papdi", "mysore pak", "halwa", "turkish delight"]),
    ],
  },
  {
    aisle: "A15",
    sign: "Nuts · Dried fruit · Jerky · Bars",
    department: "snack",
    left: [
      c("nuts", "Nuts & seeds", ["almonds", "cashews", "peanuts", "pistachios", "walnuts", "mixed nuts", "sunflower seeds", "trail mix"]),
      c("dried-fruit", "Dried fruit", ["raisins", "dates", "dried cranberries", "dried mango", "prunes", "apricots"]),
      c("jerky", "Jerky & meat snacks", ["beef jerky", "jack links", "slim jim", "meat sticks"]),
    ],
    right: [
      c("protein-bars", "Protein & energy bars", ["protein bars", "clif bars", "kind bars", "rx bars", "quest bars", "larabar"]),
      c("snack-packs", "Snack packs & lunchbox", ["snack packs", "cheese crackers packs"]),
      c("seeds-superfoods", "Seeds & superfoods", ["chia seeds", "flax seeds", "hemp seeds", "quinoa puffs"]),
    ],
  },
  // ---------------------------------------------------------------- drinks
  {
    aisle: "A16",
    sign: "Soda · Sports drinks · Energy",
    department: "drinks",
    left: [
      c("soda", "Soda", ["coke", "pepsi", "cola", "sprite", "dr pepper", "mountain dew", "pop", "soft drinks", "12 pack soda", "2 liter"], ["heavy"]),
      c("diet-soda", "Diet & zero sugar soda", ["diet coke", "coke zero", "pepsi zero", "diet dr pepper"], ["heavy"]),
      c("sports-drinks", "Sports drinks", ["gatorade", "powerade", "body armor", "electrolyte drink"], ["heavy"]),
    ],
    right: [
      c("energy-drinks", "Energy drinks", ["red bull", "monster", "celsius", "energy drink", "5 hour energy"], ["heavy"]),
      c("iced-tea-lemonade", "Bottled tea & lemonade", ["arizona tea", "pure leaf", "bottled iced tea", "lemonade bottle", "snapple"], ["heavy"]),
      c("drink-mixes", "Drink mixes & powders", ["kool aid", "crystal light", "tang", "liquid iv", "mio", "gatorade powder"]),
    ],
  },
  {
    aisle: "A17",
    sign: "Juice · Water · Sparkling",
    department: "drinks",
    left: [
      c("bottled-water", "Bottled water", ["water", "water bottles", "24 pack water", "case of water", "dasani", "aquafina", "gallon water"], ["heavy"]),
      c("sparkling-water", "Sparkling water & seltzer", ["sparkling water", "la croix", "seltzer", "bubly", "club soda", "tonic"], ["heavy"]),
      c("juice-shelf", "Shelf-stable juice", ["apple juice", "cranberry juice", "juice boxes", "capri sun", "grape juice", "v8"], ["heavy"]),
    ],
    right: [
      c("coconut-water-functional", "Coconut water & functional drinks", ["coconut water", "aloe drink"], ["heavy"]),
      c("mixers", "Mixers & bar", ["margarita mix", "bloody mary mix", "ginger beer", "grenadine"], ["heavy"]),
      c("shelf-milk", "Shelf-stable milk & plant milk", ["shelf stable milk", "boxed milk"], ["heavy"]),
      c("protein-shakes-ready", "Ready-to-drink protein shakes", ["premier protein", "fairlife core power", "muscle milk", "protein shake bottle"], ["heavy"]),
      c("bottled-coffee", "Bottled coffee & tea drinks", ["starbucks frappuccino", "bottled coffee", "yerba mate", "matcha drink"], ["heavy"]),
    ],
  },
  // ---------------------------------------------------------------- frozen
  {
    aisle: "A18",
    sign: "Frozen meals · Pizza",
    department: "frozen",
    left: [
      c("frozen-pizza", "Frozen pizza", ["frozen pizza", "digiorno", "red baron", "totinos", "pizza rolls"], ["frozen"]),
      c("frozen-dinners", "Frozen dinners & entrees", ["tv dinner", "lean cuisine", "stouffers", "frozen lasagna", "hungry man", "frozen meal"], ["frozen"]),
      c("frozen-bowls-indian", "Frozen bowls & international meals", ["frozen indian meals", "deep foods", "frozen curry", "frozen burritos", "frozen bowls"], ["frozen"]),
    ],
    right: [
      c("frozen-appetizers", "Frozen appetizers & snacks", ["mozzarella sticks", "samosas", "egg rolls", "bagel bites", "taquitos", "jalapeno poppers"], ["frozen"]),
      c("frozen-chicken", "Frozen chicken & nuggets", ["chicken nuggets", "chicken tenders", "frozen wings", "tyson"], ["frozen"]),
      c("frozen-sandwiches", "Frozen sandwiches & pockets", ["hot pockets", "frozen breakfast sandwiches", "uncrustables"], ["frozen"]),
      c("frozen-pasta-entrees", "Frozen pasta & family entrees", ["frozen mac and cheese", "frozen ravioli", "family size lasagna", "frozen enchiladas"], ["frozen"]),
    ],
  },
  {
    aisle: "A19",
    sign: "Frozen vegetables · Fruit · Breakfast",
    department: "frozen",
    left: [
      c("frozen-vegetables", "Frozen vegetables", ["frozen peas", "frozen corn", "frozen broccoli", "frozen mixed vegetables", "frozen spinach", "frozen green beans", "frozen okra"], ["frozen"]),
      c("frozen-fruit", "Frozen fruit", ["frozen berries", "frozen strawberries", "frozen mango", "smoothie fruit"], ["frozen"]),
      c("frozen-potatoes", "Frozen potatoes & fries", ["french fries", "tater tots", "hash browns", "frozen fries", "ore ida"], ["frozen"]),
    ],
    right: [
      c("frozen-breakfast", "Frozen breakfast", ["frozen waffles", "eggo", "frozen pancakes", "frozen breakfast burritos", "jimmy dean"], ["frozen"]),
      c("frozen-bread-dough", "Frozen bread, dough & pastry", ["frozen garlic bread", "frozen rolls", "puff pastry", "frozen pie crust"], ["frozen"]),
      c("frozen-indian-breads", "Frozen Indian breads & snacks", ["frozen paratha", "frozen roti", "frozen naan", "frozen samosa", "frozen idli", "frozen dosa"], ["frozen"]),
      c("frozen-rice-grains", "Frozen rice, grains & cauliflower rice", ["frozen rice", "cauliflower rice", "frozen quinoa", "frozen fried rice"], ["frozen"]),
      c("frozen-fruit-bars", "Frozen fruit bars & freezer pops", ["outshine", "fruit bars", "freeze pops", "otter pops", "paletas"], ["frozen"]),
    ],
  },
  {
    aisle: "A20",
    sign: "Ice cream · Frozen desserts",
    department: "frozen",
    left: [
      c("ice-cream", "Ice cream", ["ice cream", "icecream", "ben and jerrys", "haagen dazs", "blue bell", "vanilla ice cream", "gelato"], ["frozen"]),
      c("ice-cream-bars", "Ice cream bars & novelties", ["popsicles", "ice cream bars", "drumsticks", "klondike", "ice cream sandwiches", "kulfi"], ["frozen"]),
      c("sherbet-sorbet", "Sherbet, sorbet & non-dairy", ["sherbet", "sorbet", "dairy free ice cream", "frozen yogurt"], ["frozen"]),
    ],
    right: [
      c("frozen-desserts", "Frozen pies, cakes & whipped topping", ["cool whip", "frozen pie", "frozen cheesecake", "ice cream cake"], ["frozen"]),
      c("ice", "Ice & cones", ["bag of ice", "ice cream cones", "waffle cones"], ["frozen", "heavy"]),
    ],
  },
  {
    aisle: "A21",
    sign: "Frozen meat · Seafood",
    department: "frozen",
    left: [
      c("frozen-seafood", "Frozen seafood", ["frozen shrimp", "frozen fish", "fish sticks", "frozen salmon", "frozen tilapia", "fish fillets"], ["frozen"]),
      c("frozen-meat", "Frozen meat & burgers", ["frozen burgers", "frozen ground beef", "frozen meatballs", "frozen sausage"], ["frozen"]),
      c("frozen-veggie-protein", "Frozen plant-based & veggie burgers", ["veggie burgers", "morningstar", "impossible burger", "frozen tofu"], ["frozen"]),
    ],
    right: [
      c("frozen-turkey-ham", "Frozen turkey, ham & holiday", ["frozen turkey", "butterball", "ham", "cornish hen"], ["frozen", "heavy"]),
      c("frozen-international", "Frozen international & dumplings", ["dumplings", "potstickers", "gyoza", "frozen tamales", "bao"], ["frozen"]),
    ],
  },
  {
    aisle: "A22",
    sign: "Cheese · Lunch meat · Dips",
    department: "dairy",
    left: [
      c("shredded-cheese", "Shredded & sliced cheese", ["shredded cheese", "cheddar", "mozzarella", "kraft singles", "mexican blend"], ["chilled"]),
      c("block-specialty-cheese", "Block & specialty cheese", ["cheese block", "parmesan", "brie", "feta", "goat cheese", "cream cheese"], ["chilled"]),
      c("paneer-indian-dairy", "Paneer & international dairy", ["paneer", "nanak paneer", "amul", "indian cheese", "queso fresco", "labneh"], ["chilled"]),
      c("lunch-meat", "Packaged lunch meat", ["deli turkey packaged", "oscar mayer", "pepperoni", "ham slices packaged"], ["chilled"]),
    ],
    right: [
      c("hummus-dips", "Hummus & refrigerated dips", ["hummus", "guacamole", "spinach dip", "tzatziki", "fresh salsa"], ["chilled"]),
      c("lunchables-snack-kits", "Lunchables & snack kits", ["lunchables", "cheese sticks", "string cheese", "babybel"], ["chilled"]),
      c("refrigerated-pasta", "Refrigerated pasta & pizza dough", ["fresh pasta", "tortellini", "pizza dough", "ravioli"], ["chilled"]),
      c("kombucha-probiotic", "Kombucha, kefir & probiotic drinks", ["kombucha", "kefir", "yakult", "lassi", "probiotic drink"], ["chilled"]),
      c("dairy-free-cheese", "Plant-based cheese & dairy-free", ["vegan cheese", "dairy free yogurt", "daiya", "violife", "coconut yogurt"], ["chilled"]),
    ],
  },
  // ---------------------------------------------------------------- general merchandise
  {
    aisle: "A23",
    sign: "Paper towels · Toilet paper · Trash bags",
    department: "household",
    left: [
      c("toilet-paper", "Toilet paper", ["toilet paper", "tp", "bath tissue", "charmin", "toilet roll", "loo roll"], ["heavy"]),
      c("paper-towels", "Paper towels", ["paper towels", "bounty", "kitchen roll"], ["heavy"]),
      c("facial-tissue", "Facial tissue & napkins", ["tissues", "kleenex", "napkins"]),
    ],
    right: [
      c("trash-bags", "Trash bags", ["trash bags", "garbage bags", "hefty", "glad bags", "kitchen bags"], ["heavy"]),
      c("food-storage", "Food storage bags & wrap", ["ziploc", "sandwich bags", "foil", "aluminum foil", "plastic wrap", "parchment paper", "freezer bags"]),
      c("disposable-plates", "Disposable plates, cups & cutlery", ["paper plates", "plastic cups", "solo cups", "plastic forks", "paper bowls"]),
      c("storage-containers", "Food storage containers", ["tupperware", "glad containers", "rubbermaid", "meal prep containers", "mason jars"]),
      c("charcoal-grilling", "Charcoal & grilling supplies", ["charcoal", "kingsford", "lighter fluid", "grill brush", "propane"], ["heavy"]),
    ],
  },
  {
    aisle: "A24",
    sign: "Cleaning · Dish · Air fresheners",
    department: "household",
    left: [
      c("dish-soap", "Dish soap & dishwasher detergent", ["dish soap", "dawn", "dishwasher pods", "cascade", "finish tabs", "rinse aid"], ["heavy"]),
      c("all-purpose-cleaners", "All-purpose & kitchen cleaners", ["all purpose cleaner", "lysol spray", "clorox wipes", "disinfecting wipes", "409", "degreaser"], ["heavy"]),
      c("bathroom-cleaners", "Bathroom & toilet cleaners", ["toilet bowl cleaner", "scrubbing bubbles", "tile cleaner", "mold spray"], ["heavy"]),
      c("bleach", "Bleach & floor cleaners", ["bleach", "clorox", "pine sol", "fabuloso", "mop solution", "swiffer refills"], ["heavy"]),
    ],
    right: [
      c("glass-furniture-cleaners", "Glass & furniture cleaners", ["windex", "glass cleaner", "pledge", "stainless steel cleaner"]),
      c("sponges-gloves", "Sponges, brushes & gloves", ["sponges", "scrub daddy", "dish brush", "rubber gloves", "steel wool"]),
      c("air-fresheners", "Air fresheners & candles", ["air freshener", "febreze", "glade", "plug in", "candles"]),
      c("pest-control", "Pest control", ["ant killer", "raid", "mouse traps", "bug spray"]),
      c("mops-brooms", "Mops, brooms & dustpans", ["mop", "broom", "dustpan", "swiffer", "bucket"], ["heavy"]),
    ],
  },
  {
    aisle: "A25",
    sign: "Laundry · Detergent · Fabric softener",
    department: "household",
    left: [
      c("laundry-detergent", "Laundry detergent", ["detergent", "laundry detergent", "tide", "tide pods", "gain", "persil", "all free clear"], ["heavy"]),
      c("fabric-softener", "Fabric softener & dryer sheets", ["fabric softener", "downy", "dryer sheets", "bounce", "scent beads"], ["heavy"]),
      c("stain-remover", "Stain removers & boosters", ["oxiclean", "stain remover", "shout", "borax", "laundry booster"]),
    ],
    right: [
      c("laundry-supplies", "Laundry baskets, hangers & irons", ["laundry basket", "hangers", "iron", "ironing board", "lint roller"], ["heavy"]),
      c("batteries-lightbulbs", "Batteries & light bulbs", ["batteries", "aa batteries", "aaa batteries", "light bulbs", "led bulbs", "9v"]),
      c("hardware-basics", "Tape, glue & hardware basics", ["duct tape", "super glue", "command strips", "extension cord", "flashlight"]),
      c("kitchen-towels", "Kitchen towels & cloths", ["kitchen towels", "dish towels", "microfiber cloths", "dish cloths"]),
    ],
  },
  {
    aisle: "A26",
    sign: "Pet · Dog · Cat",
    department: "pet",
    left: [
      c("dog-food", "Dog food", ["dog food", "purina dog", "pedigree", "blue buffalo", "kibble", "dog food bag"], ["heavy"]),
      c("dog-treats-toys", "Dog treats, chews & toys", ["dog treats", "milk bone", "dog chews", "rawhide", "dog toy"]),
      c("dog-supplies", "Dog supplies & grooming", ["dog shampoo", "leash", "dog collar", "poop bags", "flea treatment"]),
    ],
    right: [
      c("cat-food", "Cat food", ["cat food", "fancy feast", "friskies", "meow mix", "kitten food", "wet cat food"], ["heavy"]),
      c("cat-litter", "Cat litter", ["cat litter", "litter", "tidy cats", "litter box"], ["heavy"]),
      c("cat-treats-supplies", "Cat treats, toys & supplies", ["cat treats", "temptations", "cat toys", "scratching post"]),
      c("small-pet-fish-bird", "Fish, bird & small pet", ["fish food", "bird seed", "hamster food", "aquarium"]),
    ],
  },
  {
    aisle: "A27",
    sign: "Baby · Diapers · Formula · Wipes",
    department: "baby",
    left: [
      c("diapers", "Diapers & training pants", ["diapers", "pampers", "huggies", "pull ups", "size 4 diapers", "overnight diapers"], ["heavy"]),
      c("baby-wipes", "Baby wipes", ["baby wipes", "wipes", "water wipes"]),
      c("baby-formula", "Baby formula", ["formula", "similac", "enfamil", "infant formula", "toddler formula"], ["heavy"]),
      c("baby-food", "Baby food & snacks", ["baby food", "gerber", "baby food pouches", "puffs", "teething crackers", "cerelac"]),
    ],
    right: [
      c("baby-bath-skin", "Baby bath, lotion & diaper cream", ["baby shampoo", "johnsons", "baby lotion", "desitin", "diaper rash cream", "aquaphor baby"]),
      c("bottles-feeding", "Bottles, pacifiers & feeding", ["baby bottles", "pacifier", "sippy cup", "bottle brush", "nipples"]),
      c("baby-health", "Baby medicine & health", ["infant tylenol", "gripe water", "baby gas drops", "nasal aspirator", "teething gel"]),
    ],
  },
  {
    aisle: "A28",
    sign: "Vitamins · Pain relief · First aid",
    department: "pharmacy",
    left: [
      c("pain-relief", "Pain relief", ["tylenol", "advil", "ibuprofen", "aleve", "aspirin", "acetaminophen", "pain reliever", "excedrin"]),
      c("vitamins", "Vitamins & supplements", ["vitamins", "multivitamin", "vitamin d", "vitamin c", "fish oil", "melatonin", "magnesium", "zinc"]),
      c("first-aid", "First aid", ["band aids", "bandages", "neosporin", "hydrogen peroxide", "rubbing alcohol", "gauze", "first aid kit"]),
      c("sleep-aids", "Sleep aids & motion sickness", ["sleep aid", "zzzquil", "dramamine", "unisom"]),
    ],
    right: [
      c("diabetes-care", "Diabetes & blood pressure care", ["glucose tablets", "blood pressure monitor", "lancets", "glucose meter"]),
      c("foot-care", "Foot care & support", ["insoles", "dr scholls", "foot powder", "ankle brace", "compression socks"]),
      c("thermometers", "Thermometers & health devices", ["thermometer", "pulse oximeter", "humidifier", "heating pad"]),
      c("incontinence", "Incontinence & adult care", ["depends", "adult diapers", "bladder pads"], ["heavy"]),
      c("smoking-cessation", "Smoking cessation", ["nicotine gum", "nicotine patches", "nicorette"]),
      c("kids-medicine", "Children's medicine", ["childrens tylenol", "childrens motrin", "kids cold medicine", "pedialyte", "childrens allergy"]),
    ],
  },
  {
    aisle: "A29",
    sign: "Hair care · Skin care · Oral care",
    department: "pharmacy",
    left: [
      c("shampoo-conditioner", "Shampoo & conditioner", ["shampoo", "conditioner", "head and shoulders", "pantene", "dove shampoo", "dry shampoo"]),
      c("hair-styling", "Hair styling & color", ["hair gel", "hairspray", "hair dye", "hair color", "mousse", "hair oil"]),
      c("body-wash-soap", "Body wash & bar soap", ["body wash", "soap", "bar soap", "dove", "irish spring", "dial"]),
      c("lotion-skin-care", "Lotion & skin care", ["lotion", "body lotion", "moisturizer", "cetaphil", "vaseline", "sunscreen", "face wash", "lip balm"]),
    ],
    right: [
      c("toothpaste", "Toothpaste & mouthwash", ["toothpaste", "colgate", "crest", "mouthwash", "listerine", "whitening strips"]),
      c("toothbrushes-floss", "Toothbrushes & floss", ["toothbrush", "floss", "electric toothbrush heads", "dental picks"]),
      c("deodorant", "Deodorant", ["deodorant", "antiperspirant", "old spice", "secret", "degree"]),
      c("cotton-swabs", "Cotton balls, swabs & pads", ["q tips", "cotton balls", "cotton rounds", "cotton swabs"]),
      c("facial-care", "Facial care & acne", ["face mask", "acne wash", "cerave", "neutrogena", "micellar water", "toner"]),
      c("hair-accessories", "Hair accessories & brushes", ["hair ties", "hair brush", "comb", "bobby pins", "headbands", "scrunchies"]),
    ],
  },
  {
    aisle: "A30",
    sign: "Shaving · Feminine care · Family planning",
    department: "pharmacy",
    left: [
      c("razors-shaving", "Razors & shaving", ["razors", "razor blades", "gillette", "shaving cream", "shave gel", "electric razor"]),
      c("feminine-care", "Feminine care", ["tampons", "pads", "always", "tampax", "panty liners", "feminine wash"]),
      c("family-planning", "Family planning", ["condoms", "pregnancy test", "lubricant", "ovulation test"]),
    ],
    right: [
      c("hand-soap-sanitizer", "Hand soap & sanitizer", ["hand soap", "softsoap", "hand sanitizer", "purell", "foaming hand soap"]),
      c("mens-grooming", "Men's grooming & beard care", ["beard oil", "beard trimmer", "aftershave", "pomade"]),
      c("travel-sizes", "Travel sizes & trial", ["travel size", "travel toiletries", "mini shampoo"]),
      c("body-spray-fragrance", "Body spray & fragrance", ["body spray", "axe", "perfume", "cologne", "body mist"]),
    ],
  },
];
