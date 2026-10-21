// Cook mode's dish table: common home dishes, half Indian home staples and half Western and global, each written by
// hand for TWO servings of a normal home portion (the app scales by the number of people). Quantities are what goes
// into the pot, not what is bought: packages/core meals/plan.ts rounds the merged list up to the store's packs.
// `core` names the ingredients without which it is not the dish; test/meals.test.ts checks every dish lists them,
// that every key is a known ingredient, and that no quantity is absurd.

import type { Dish, DishIngredient, RawUnit } from "@grosher/core";

type Line = [key: string, qty: number, unit: RawUnit, optional?: "opt"];
const d = (id: string, name: string, cuisine: Dish["cuisine"], aliases: string[], core: string[], lines: Line[]): Dish => ({
  id,
  name,
  cuisine,
  aliases,
  core,
  items: lines.map(([key, qty, unit, opt]): DishIngredient => ({ key, qty, unit, ...(opt ? { optional: true } : {}) })),
});

// the everyday seasoning most Indian dishes share (pantry: shown under "You probably have")
const tadka: Line[] = [["salt", 1, "tsp"], ["turmeric", 0.5, "tsp"], ["chili-powder", 1, "tsp"], ["cumin", 1, "tsp"]];

export const DISHES: Dish[] = [
  // ---------------------------------------------------------------- Indian home staples
  d("dal-chawal", "Dal chawal", "indian", ["dal-chawal", "dal rice", "dal and rice", "dal chaval", "daal chawal"], ["toor-dal", "basmati"], [
    ["toor-dal", 150, "g"], ["basmati", 180, "g"], ["onion", 1, "piece"], ["tomato", 2, "piece"], ["garlic", 3, "clove"], ["ginger", 10, "g"], ["green-chili", 2, "piece"], ["cilantro", 0.25, "bunch", "opt"], ["ghee", 1, "tbsp"], ...tadka,
  ]),
  d("rajma-chawal", "Rajma chawal", "indian", ["rajma", "rajma rice", "rajma chaval", "kidney bean curry"], ["rajma", "basmati"], [
    ["rajma", 150, "g"], ["basmati", 180, "g"], ["onion", 2, "piece"], ["tomato", 3, "piece"], ["garlic", 4, "clove"], ["ginger", 15, "g"], ["green-chili", 2, "piece"], ["cilantro", 0.25, "bunch", "opt"], ["oil", 2, "tbsp"], ["garam-masala", 1, "tsp"], ...tadka,
  ]),
  d("chole", "Chole", "indian", ["chana masala", "chole masala", "chickpea curry", "chhole"], ["kabuli-chana", "onion", "tomato"], [
    ["kabuli-chana", 150, "g"], ["onion", 2, "piece"], ["tomato", 3, "piece"], ["ginger", 15, "g"], ["garlic", 4, "clove"], ["green-chili", 2, "piece"], ["chole-masala", 2, "tsp"], ["lemon", 1, "piece", "opt"], ["cilantro", 0.25, "bunch", "opt"], ["oil", 2, "tbsp"], ["salt", 1, "tsp"], ["turmeric", 0.5, "tsp"],
  ]),
  d("chole-bhature", "Chole bhature", "indian", ["chole bhatura", "chhole bhature"], ["kabuli-chana", "maida"], [
    ["kabuli-chana", 150, "g"], ["onion", 2, "piece"], ["tomato", 2, "piece"], ["ginger", 15, "g"], ["garlic", 4, "clove"], ["green-chili", 2, "piece"], ["chole-masala", 2, "tsp"], ["maida", 250, "g"], ["yogurt", 100, "g"], ["baking-soda", 0.5, "tsp"], ["oil", 300, "ml"], ["salt", 1, "tsp"],
  ]),
  d("poha", "Poha", "indian", ["kanda poha", "aloo poha", "batata poha"], ["poha", "onion"], [
    ["poha", 150, "g"], ["onion", 1, "piece"], ["potato", 1, "piece", "opt"], ["green-chili", 2, "piece"], ["peanuts", 40, "g"], ["curry-leaves", 0.5, "bunch"], ["lemon", 1, "piece"], ["cilantro", 0.25, "bunch", "opt"], ["mustard-seeds", 1, "tsp"], ["turmeric", 0.5, "tsp"], ["sugar", 1, "tsp"], ["oil", 2, "tbsp"], ["salt", 1, "tsp"],
  ]),
  d("upma", "Upma", "indian", ["rava upma", "sooji upma"], ["rava"], [
    ["rava", 150, "g"], ["onion", 1, "piece"], ["green-chili", 2, "piece"], ["ginger", 10, "g"], ["carrot", 1, "piece", "opt"], ["peas", 50, "g", "opt"], ["curry-leaves", 0.5, "bunch"], ["cashews", 20, "g", "opt"], ["mustard-seeds", 1, "tsp"], ["ghee", 1, "tbsp"], ["salt", 1, "tsp"],
  ]),
  d("aloo-paratha", "Aloo paratha", "indian", ["aloo parantha", "potato paratha", "aloo ke parathe"], ["atta", "potato"], [
    ["atta", 250, "g"], ["potato", 3, "piece"], ["green-chili", 2, "piece"], ["cilantro", 0.25, "bunch"], ["ginger", 10, "g"], ["butter", 30, "g"], ["yogurt", 200, "g", "opt"], ["ajwain", 0.5, "tsp"], ["chili-powder", 0.5, "tsp"], ["salt", 1, "tsp"],
  ]),
  d("paneer-butter-masala", "Paneer butter masala", "indian", ["paneer makhani", "paneer makhanwala", "butter paneer"], ["paneer", "tomato", "cream", "butter"], [
    ["paneer", 250, "g"], ["tomato", 4, "piece"], ["onion", 1, "piece"], ["cream", 100, "ml"], ["butter", 30, "g"], ["cashews", 20, "g"], ["ginger", 15, "g"], ["garlic", 4, "clove"], ["kasuri-methi", 1, "tbsp"], ["garam-masala", 1, "tsp"], ["chili-powder", 1, "tsp"], ["sugar", 1, "tsp"], ["salt", 1, "tsp"],
  ]),
  d("palak-paneer", "Palak paneer", "indian", ["saag paneer", "spinach paneer"], ["spinach", "paneer"], [
    ["spinach", 400, "g"], ["paneer", 200, "g"], ["onion", 1, "piece"], ["tomato", 1, "piece"], ["garlic", 4, "clove"], ["ginger", 10, "g"], ["green-chili", 2, "piece"], ["cream", 50, "ml", "opt"], ["oil", 2, "tbsp"], ["garam-masala", 0.5, "tsp"], ["cumin", 1, "tsp"], ["salt", 1, "tsp"],
  ]),
  d("khichdi", "Khichdi", "indian", ["khichri", "moong dal khichdi", "dal khichdi"], ["moong-dal", "rice"], [
    ["moong-dal", 100, "g"], ["rice", 100, "g"], ["ghee", 1, "tbsp"], ["ginger", 10, "g"], ["peas", 50, "g", "opt"], ["cumin", 1, "tsp"], ["turmeric", 0.5, "tsp"], ["hing", 1, "pinch"], ["salt", 1, "tsp"],
  ]),
  d("chicken-biryani", "Chicken biryani", "indian", ["biryani", "chicken biriyani", "hyderabadi biryani", "dum biryani"], ["chicken", "basmati", "yogurt", "onion"], [
    ["chicken", 500, "g"], ["basmati", 250, "g"], ["onion", 3, "piece"], ["yogurt", 150, "g"], ["tomato", 1, "piece"], ["ginger", 20, "g"], ["garlic", 6, "clove"], ["green-chili", 3, "piece"], ["mint", 0.5, "bunch"], ["cilantro", 0.5, "bunch"], ["biryani-masala", 2, "tbsp"], ["ghee", 2, "tbsp"], ["saffron", 1, "pinch", "opt"], ["lemon", 1, "piece"], ["oil", 2, "tbsp"], ["salt", 2, "tsp"],
  ]),
  d("veg-biryani", "Veg biryani", "indian", ["vegetable biryani", "veg biriyani"], ["basmati", "carrot", "yogurt"], [
    ["basmati", 250, "g"], ["carrot", 1, "piece"], ["green-beans", 100, "g"], ["potato", 1, "piece"], ["peas", 75, "g"], ["onion", 2, "piece"], ["yogurt", 100, "g"], ["mint", 0.5, "bunch"], ["cilantro", 0.5, "bunch"], ["biryani-masala", 2, "tbsp"], ["ghee", 2, "tbsp"], ["ginger", 15, "g"], ["garlic", 4, "clove"], ["salt", 2, "tsp"],
  ]),
  d("masala-dosa", "Masala dosa", "indian", ["dosa", "masala dosai"], ["dosa-batter", "potato"], [
    ["dosa-batter", 500, "g"], ["potato", 3, "piece"], ["onion", 1, "piece"], ["green-chili", 2, "piece"], ["curry-leaves", 0.5, "bunch"], ["mustard-seeds", 1, "tsp"], ["turmeric", 0.5, "tsp"], ["oil", 3, "tbsp"], ["salt", 1, "tsp"],
  ]),
  d("idli-sambar", "Idli sambar", "indian", ["idli", "idly sambar", "idli with sambar"], ["idli-batter", "toor-dal", "sambar-powder"], [
    ["idli-batter", 500, "g"], ["toor-dal", 100, "g"], ["sambar-powder", 2, "tbsp"], ["tamarind", 20, "g"], ["onion", 1, "piece"], ["tomato", 2, "piece"], ["carrot", 1, "piece"], ["curry-leaves", 0.5, "bunch"], ["mustard-seeds", 1, "tsp"], ["oil", 1, "tbsp"], ["salt", 1, "tsp"],
  ]),
  d("sambar-rice", "Sambar rice", "indian", ["sambar sadam", "sambar chawal", "sambar"], ["toor-dal", "rice", "sambar-powder"], [
    ["toor-dal", 100, "g"], ["rice", 180, "g"], ["sambar-powder", 2, "tbsp"], ["tamarind", 20, "g"], ["tomato", 2, "piece"], ["onion", 1, "piece"], ["carrot", 1, "piece"], ["eggplant", 1, "piece", "opt"], ["curry-leaves", 0.5, "bunch"], ["mustard-seeds", 1, "tsp"], ["oil", 1, "tbsp"], ["salt", 1, "tsp"],
  ]),
  d("butter-chicken", "Butter chicken", "indian", ["murgh makhani", "chicken makhani"], ["chicken", "tomato", "butter", "cream"], [
    ["chicken", 500, "g"], ["tomato", 4, "piece"], ["cream", 100, "ml"], ["butter", 40, "g"], ["yogurt", 100, "g"], ["ginger", 15, "g"], ["garlic", 5, "clove"], ["kasuri-methi", 1, "tbsp"], ["garam-masala", 1, "tsp"], ["chili-powder", 1, "tsp"], ["cashews", 20, "g"], ["salt", 1, "tsp"],
  ]),
  d("chicken-curry", "Chicken curry", "indian", ["chicken masala", "murgh curry", "chicken gravy"], ["chicken", "onion", "tomato"], [
    ["chicken", 500, "g"], ["onion", 2, "piece"], ["tomato", 2, "piece"], ["ginger", 15, "g"], ["garlic", 5, "clove"], ["green-chili", 2, "piece"], ["yogurt", 100, "g"], ["oil", 2, "tbsp"], ["garam-masala", 1, "tsp"], ["coriander-powder", 1, "tsp"], ["cilantro", 0.25, "bunch", "opt"], ...tadka,
  ]),
  d("egg-curry", "Egg curry", "indian", ["anda curry", "egg masala"], ["eggs", "onion", "tomato"], [
    ["eggs", 4, "piece"], ["onion", 2, "piece"], ["tomato", 2, "piece"], ["ginger", 10, "g"], ["garlic", 4, "clove"], ["green-chili", 1, "piece"], ["oil", 2, "tbsp"], ["garam-masala", 1, "tsp"], ["cilantro", 0.25, "bunch", "opt"], ...tadka,
  ]),
  d("aloo-gobi", "Aloo gobi", "indian", ["aloo gobhi", "potato cauliflower"], ["potato", "cauliflower"], [
    ["cauliflower", 1, "piece"], ["potato", 2, "piece"], ["onion", 1, "piece"], ["tomato", 1, "piece"], ["ginger", 10, "g"], ["green-chili", 1, "piece"], ["cilantro", 0.25, "bunch", "opt"], ["oil", 2, "tbsp"], ...tadka,
  ]),
  d("bhindi-masala", "Bhindi masala", "indian", ["bhindi", "okra masala", "bhindi fry"], ["okra"], [
    ["okra", 300, "g"], ["onion", 1, "piece"], ["tomato", 1, "piece"], ["amchur", 1, "tsp"], ["oil", 2, "tbsp"], ...tadka,
  ]),
  d("baingan-bharta", "Baingan bharta", "indian", ["baingan ka bharta", "eggplant bharta", "brinjal bharta"], ["eggplant"], [
    ["eggplant", 2, "piece"], ["onion", 1, "piece"], ["tomato", 2, "piece"], ["garlic", 4, "clove"], ["green-chili", 2, "piece"], ["cilantro", 0.25, "bunch", "opt"], ["oil", 2, "tbsp"], ...tadka,
  ]),
  d("matar-paneer", "Matar paneer", "indian", ["mutter paneer", "peas paneer"], ["paneer", "peas"], [
    ["paneer", 200, "g"], ["peas", 150, "g"], ["onion", 1, "piece"], ["tomato", 2, "piece"], ["ginger", 10, "g"], ["garlic", 3, "clove"], ["cream", 50, "ml", "opt"], ["oil", 2, "tbsp"], ["garam-masala", 1, "tsp"], ...tadka,
  ]),
  d("kadhi-chawal", "Kadhi chawal", "indian", ["kadhi", "kadhi pakora", "kadhi rice"], ["yogurt", "besan", "rice"], [
    ["yogurt", 400, "g"], ["besan", 40, "g"], ["rice", 180, "g"], ["onion", 1, "piece"], ["ginger", 10, "g"], ["green-chili", 2, "piece"], ["curry-leaves", 0.5, "bunch"], ["mustard-seeds", 1, "tsp"], ["fenugreek-seeds", 0.5, "tsp"], ["ghee", 1, "tbsp"], ["turmeric", 0.5, "tsp"], ["salt", 1, "tsp"],
  ]),
  d("pav-bhaji", "Pav bhaji", "indian", ["paav bhaji", "pao bhaji"], ["pav", "potato", "pav-bhaji-masala"], [
    ["pav", 6, "piece"], ["potato", 2, "piece"], ["cauliflower", 0.5, "piece"], ["peas", 100, "g"], ["bell-pepper", 1, "piece"], ["onion", 2, "piece"], ["tomato", 3, "piece"], ["butter", 60, "g"], ["pav-bhaji-masala", 2, "tbsp"], ["lemon", 1, "piece"], ["cilantro", 0.25, "bunch"], ["salt", 1, "tsp"],
  ]),
  d("vada-pav", "Vada pav", "indian", ["wada pav", "vada paav", "batata vada"], ["pav", "potato", "besan"], [
    ["pav", 4, "piece"], ["potato", 3, "piece"], ["besan", 100, "g"], ["green-chili", 3, "piece"], ["garlic", 4, "clove"], ["ginger", 10, "g"], ["curry-leaves", 0.5, "bunch"], ["mustard-seeds", 1, "tsp"], ["turmeric", 0.5, "tsp"], ["oil", 300, "ml"], ["salt", 1, "tsp"],
  ]),
  d("dal-makhani", "Dal makhani", "indian", ["daal makhani", "maa ki dal", "dal makhni"], ["urad-whole", "butter", "cream"], [
    ["urad-whole", 100, "g"], ["rajma", 30, "g"], ["butter", 40, "g"], ["cream", 100, "ml"], ["tomato", 3, "piece"], ["onion", 1, "piece"], ["ginger", 10, "g"], ["garlic", 4, "clove"], ["garam-masala", 1, "tsp"], ["chili-powder", 1, "tsp"], ["salt", 1, "tsp"],
  ]),
  d("dal-tadka", "Dal tadka", "indian", ["dal fry", "tadka dal", "yellow dal", "dal"], ["toor-dal"], [
    ["toor-dal", 150, "g"], ["onion", 1, "piece"], ["tomato", 2, "piece"], ["garlic", 5, "clove"], ["green-chili", 2, "piece"], ["ghee", 2, "tbsp"], ["chili-flakes", 1, "tsp"], ["cilantro", 0.25, "bunch", "opt"], ...tadka,
  ]),
  d("jeera-rice", "Jeera rice", "indian", ["cumin rice", "zeera rice"], ["basmati", "cumin"], [
    ["basmati", 180, "g"], ["ghee", 1, "tbsp"], ["cumin", 1, "tsp"], ["bay-leaves", 1, "piece"], ["salt", 1, "tsp"],
  ]),
  d("lemon-rice", "Lemon rice", "indian", ["chitranna", "nimmakaya pulihora"], ["rice", "lemon"], [
    ["rice", 180, "g"], ["lemon", 2, "piece"], ["peanuts", 30, "g"], ["curry-leaves", 0.5, "bunch"], ["green-chili", 2, "piece"], ["mustard-seeds", 1, "tsp"], ["turmeric", 0.5, "tsp"], ["oil", 2, "tbsp"], ["salt", 1, "tsp"],
  ]),
  d("curd-rice", "Curd rice", "indian", ["thayir sadam", "dahi chawal", "yogurt rice"], ["rice", "yogurt"], [
    ["rice", 150, "g"], ["yogurt", 300, "g"], ["milk", 100, "ml"], ["ginger", 10, "g"], ["green-chili", 1, "piece"], ["curry-leaves", 0.5, "bunch"], ["mustard-seeds", 1, "tsp"], ["oil", 1, "tbsp"], ["salt", 1, "tsp"],
  ]),
  d("roti", "Roti", "indian", ["chapati", "phulka", "roti sabzi", "chapatis"], ["atta"], [
    ["atta", 200, "g"], ["ghee", 1, "tbsp", "opt"], ["salt", 0.5, "tsp"],
  ]),
  d("mixed-veg", "Mixed vegetable curry", "indian", ["mixed veg", "mix veg", "sabzi", "veg curry"], ["carrot", "potato", "peas"], [
    ["carrot", 1, "piece"], ["green-beans", 100, "g"], ["peas", 100, "g"], ["potato", 1, "piece"], ["cauliflower", 0.25, "piece"], ["onion", 1, "piece"], ["tomato", 2, "piece"], ["ginger", 10, "g"], ["garlic", 3, "clove"], ["oil", 2, "tbsp"], ["garam-masala", 1, "tsp"], ...tadka,
  ]),
  d("kheer", "Kheer", "indian", ["rice kheer", "chawal ki kheer", "payasam"], ["milk", "rice", "sugar"], [
    ["milk", 1000, "ml"], ["rice", 50, "g"], ["sugar", 80, "g"], ["cardamom", 0.5, "tsp"], ["almonds", 20, "g"], ["saffron", 1, "pinch", "opt"],
  ]),
  d("gajar-halwa", "Gajar halwa", "indian", ["gajar ka halwa", "carrot halwa"], ["carrot", "milk", "sugar"], [
    ["carrot", 500, "g"], ["milk", 500, "ml"], ["sugar", 80, "g"], ["ghee", 2, "tbsp"], ["cardamom", 0.5, "tsp"], ["cashews", 20, "g"],
  ]),
  d("masoor-dal", "Masoor dal", "indian", ["red lentil dal", "masoor ki dal"], ["masoor-dal"], [
    ["masoor-dal", 150, "g"], ["onion", 1, "piece"], ["tomato", 1, "piece"], ["garlic", 3, "clove"], ["ginger", 10, "g"], ["green-chili", 1, "piece"], ["ghee", 1, "tbsp"], ...tadka,
  ]),
  d("chana-dal", "Chana dal", "indian", ["chana dal fry", "chane ki dal"], ["chana-dal"], [
    ["chana-dal", 150, "g"], ["onion", 1, "piece"], ["tomato", 2, "piece"], ["ginger", 10, "g"], ["green-chili", 2, "piece"], ["ghee", 1, "tbsp"], ["garam-masala", 0.5, "tsp"], ...tadka,
  ]),
  d("methi-thepla", "Methi thepla", "indian", ["thepla", "methi paratha"], ["atta", "methi"], [
    ["atta", 200, "g"], ["methi", 1, "bunch"], ["yogurt", 50, "g"], ["besan", 30, "g"], ["oil", 2, "tbsp"], ["ajwain", 0.5, "tsp"], ["turmeric", 0.5, "tsp"], ["chili-powder", 1, "tsp"], ["salt", 1, "tsp"],
  ]),
  d("veg-pulao", "Veg pulao", "indian", ["pulao", "vegetable pulao", "pulav", "veg pilaf"], ["basmati"], [
    ["basmati", 200, "g"], ["carrot", 1, "piece"], ["peas", 75, "g"], ["green-beans", 75, "g"], ["onion", 1, "piece"], ["ghee", 1, "tbsp"], ["bay-leaves", 1, "piece"], ["whole-spices", 4, "piece"], ["cinnamon", 1, "piece"], ["cashews", 20, "g", "opt"], ["salt", 1, "tsp"],
  ]),
  d("samosa", "Samosa", "indian", ["aloo samosa", "samosas"], ["maida", "potato"], [
    ["maida", 200, "g"], ["potato", 3, "piece"], ["peas", 75, "g"], ["green-chili", 2, "piece"], ["ginger", 10, "g"], ["oil", 400, "ml"], ["cumin", 1, "tsp"], ["coriander-powder", 1, "tsp"], ["garam-masala", 0.5, "tsp"], ["salt", 1, "tsp"],
  ]),
  d("tandoori-chicken", "Tandoori chicken", "indian", ["chicken tandoori"], ["chicken", "yogurt", "tandoori-masala"], [
    ["chicken", 750, "g"], ["yogurt", 150, "g"], ["ginger", 15, "g"], ["garlic", 5, "clove"], ["lemon", 1, "piece"], ["tandoori-masala", 2, "tbsp"], ["oil", 1, "tbsp"], ["salt", 1, "tsp"],
  ]),
  d("fish-curry", "Fish curry", "indian", ["meen curry", "machher jhol", "goan fish curry"], ["white-fish", "coconut-milk"], [
    ["white-fish", 500, "g"], ["onion", 1, "piece"], ["tomato", 2, "piece"], ["coconut-milk", 200, "ml"], ["tamarind", 15, "g"], ["curry-leaves", 0.5, "bunch"], ["mustard-seeds", 1, "tsp"], ["ginger", 10, "g"], ["garlic", 4, "clove"], ["oil", 2, "tbsp"], ...tadka,
  ]),
  d("sabudana-khichdi", "Sabudana khichdi", "indian", ["sabudana", "sago khichdi"], ["sabudana", "peanuts"], [
    ["sabudana", 150, "g"], ["potato", 1, "piece"], ["peanuts", 60, "g"], ["green-chili", 2, "piece"], ["lemon", 1, "piece"], ["cilantro", 0.25, "bunch", "opt"], ["ghee", 1, "tbsp"], ["cumin", 1, "tsp"], ["salt", 1, "tsp"],
  ]),

  // ---------------------------------------------------------------- Western and global
  d("pasta-arrabbiata", "Pasta arrabbiata", "global", ["arrabbiata", "penne arrabbiata", "arrabiata", "penne all'arrabbiata"], ["penne", "canned-tomatoes", "garlic"], [
    ["penne", 200, "g"], ["canned-tomatoes", 400, "g"], ["garlic", 4, "clove"], ["chili-flakes", 1, "tsp"], ["olive-oil", 2, "tbsp"], ["parsley", 0.25, "bunch", "opt"], ["parmesan", 30, "g", "opt"], ["salt", 1, "tsp"],
  ]),
  d("spaghetti-bolognese", "Spaghetti bolognese", "global", ["bolognese", "spag bol", "pasta bolognese"], ["spaghetti", "ground-beef", "canned-tomatoes"], [
    ["spaghetti", 200, "g"], ["ground-beef", 300, "g"], ["onion", 1, "piece"], ["carrot", 1, "piece"], ["celery", 80, "g"], ["garlic", 2, "clove"], ["canned-tomatoes", 400, "g"], ["tomato-paste", 2, "tbsp"], ["olive-oil", 1, "tbsp"], ["parmesan", 30, "g", "opt"], ["oregano", 1, "tsp"], ["salt", 1, "tsp"],
  ]),
  d("fettuccine-alfredo", "Fettuccine alfredo", "global", ["alfredo", "pasta alfredo", "chicken alfredo"], ["fettuccine", "cream", "parmesan"], [
    ["fettuccine", 200, "g"], ["butter", 30, "g"], ["cream", 200, "ml"], ["parmesan", 60, "g"], ["garlic", 2, "clove"], ["black-pepper", 0.5, "tsp"], ["salt", 0.5, "tsp"],
  ]),
  d("pesto-pasta", "Pesto pasta", "global", ["pasta pesto", "pasta with pesto", "pesto"], ["penne", "pesto"], [
    ["penne", 200, "g"], ["pesto", 120, "g"], ["parmesan", 30, "g"], ["olive-oil", 1, "tbsp"], ["salt", 0.5, "tsp"],
  ]),
  d("mac-and-cheese", "Mac and cheese", "global", ["macaroni and cheese", "mac n cheese", "mac & cheese"], ["macaroni", "cheddar", "milk"], [
    ["macaroni", 200, "g"], ["cheddar", 150, "g"], ["milk", 300, "ml"], ["butter", 30, "g"], ["maida", 25, "g"], ["salt", 0.5, "tsp"],
  ]),
  d("veg-stir-fry", "Vegetable stir-fry", "global", ["stir-fry", "stir fry", "veg stir fry", "stir-fried vegetables"], ["bell-pepper", "broccoli", "soy-sauce"], [
    ["bell-pepper", 2, "piece"], ["broccoli", 1, "piece"], ["carrot", 1, "piece"], ["onion", 1, "piece"], ["garlic", 3, "clove"], ["ginger", 10, "g"], ["soy-sauce", 3, "tbsp"], ["spring-onion", 0.5, "bunch", "opt"], ["oil", 2, "tbsp"], ["rice", 180, "g"],
  ]),
  d("chicken-stir-fry", "Chicken stir-fry", "global", ["chicken stir fry", "stir fried chicken"], ["chicken", "soy-sauce"], [
    ["chicken", 400, "g"], ["bell-pepper", 1, "piece"], ["broccoli", 1, "piece"], ["onion", 1, "piece"], ["garlic", 3, "clove"], ["ginger", 10, "g"], ["soy-sauce", 3, "tbsp"], ["oyster-sauce", 1, "tbsp"], ["cornstarch", 1, "tbsp"], ["oil", 2, "tbsp"], ["rice", 180, "g"],
  ]),
  d("fried-rice", "Fried rice", "global", ["egg fried rice", "veg fried rice", "vegetable fried rice"], ["rice", "eggs", "soy-sauce"], [
    ["rice", 200, "g"], ["eggs", 2, "piece"], ["peas", 75, "g"], ["carrot", 1, "piece"], ["spring-onion", 0.5, "bunch"], ["soy-sauce", 2, "tbsp"], ["garlic", 2, "clove"], ["oil", 2, "tbsp"],
  ]),
  d("tacos", "Tacos", "global", ["beef tacos", "taco night", "ground beef tacos"], ["tortillas", "ground-beef"], [
    ["tortillas", 6, "piece"], ["ground-beef", 300, "g"], ["onion", 1, "piece"], ["tomato", 2, "piece"], ["lettuce", 0.5, "piece"], ["cheddar", 80, "g"], ["sour-cream", 100, "g", "opt"], ["taco-seasoning", 30, "g"], ["lime", 1, "piece", "opt"], ["cilantro", 0.25, "bunch", "opt"],
  ]),
  d("burrito-bowl", "Burrito bowl", "global", ["burrito", "chicken burrito bowl", "burritos"], ["rice", "black-beans", "chicken"], [
    ["rice", 150, "g"], ["black-beans", 400, "g"], ["chicken", 300, "g"], ["corn", 150, "g"], ["tomato", 2, "piece"], ["onion", 1, "piece"], ["lime", 1, "piece"], ["avocado", 1, "piece"], ["cilantro", 0.25, "bunch", "opt"], ["cheddar", 60, "g", "opt"], ["cumin", 1, "tsp"],
  ]),
  d("quesadilla", "Quesadillas", "global", ["quesadilla", "cheese quesadilla", "chicken quesadilla"], ["tortillas", "cheddar"], [
    ["tortillas", 4, "piece"], ["cheddar", 150, "g"], ["bell-pepper", 1, "piece"], ["onion", 1, "piece"], ["chicken", 200, "g", "opt"], ["sour-cream", 50, "g", "opt"], ["oil", 1, "tbsp"],
  ]),
  d("omelette", "Omelette", "global", ["omelet", "masala omelette", "cheese omelette", "egg omelette"], ["eggs"], [
    ["eggs", 4, "piece"], ["onion", 1, "piece"], ["tomato", 1, "piece"], ["bell-pepper", 0.5, "piece", "opt"], ["cheddar", 40, "g", "opt"], ["butter", 15, "g"], ["milk", 30, "ml"], ["salt", 0.5, "tsp"], ["black-pepper", 0.25, "tsp"],
  ]),
  d("scrambled-eggs", "Scrambled eggs on toast", "global", ["scrambled eggs", "eggs on toast", "egg toast"], ["eggs", "bread"], [
    ["eggs", 4, "piece"], ["butter", 20, "g"], ["milk", 50, "ml"], ["bread", 4, "slice"], ["salt", 0.5, "tsp"], ["black-pepper", 0.25, "tsp"],
  ]),
  d("pancakes", "Pancakes", "global", ["pancake", "buttermilk pancakes", "american pancakes"], ["maida", "milk", "eggs"], [
    ["maida", 150, "g"], ["milk", 250, "ml"], ["eggs", 1, "piece"], ["butter", 30, "g"], ["sugar", 20, "g"], ["baking-powder", 1, "tsp"], ["maple-syrup", 60, "ml"], ["salt", 0.25, "tsp"],
  ]),
  d("french-toast", "French toast", "global", ["eggy bread"], ["bread", "eggs", "milk"], [
    ["bread", 4, "slice"], ["eggs", 2, "piece"], ["milk", 120, "ml"], ["butter", 20, "g"], ["cinnamon", 0.5, "tsp"], ["sugar", 1, "tbsp"], ["maple-syrup", 60, "ml", "opt"],
  ]),
  d("greek-salad", "Greek salad", "global", ["horiatiki", "greek salad with feta"], ["cucumber", "tomato", "feta"], [
    ["cucumber", 1, "piece"], ["tomato", 3, "piece"], ["red-onion", 1, "piece"], ["bell-pepper", 1, "piece"], ["feta", 150, "g"], ["olives", 80, "g"], ["olive-oil", 2, "tbsp"], ["oregano", 1, "tsp"], ["salt", 0.25, "tsp"],
  ]),
  d("caesar-salad", "Caesar salad", "global", ["chicken caesar salad", "caesar"], ["romaine", "parmesan", "caesar-dressing"], [
    ["romaine", 1, "piece"], ["parmesan", 40, "g"], ["croutons", 60, "g"], ["caesar-dressing", 80, "ml"], ["lemon", 1, "piece", "opt"], ["chicken", 300, "g", "opt"],
  ]),
  d("garden-salad", "Garden salad", "global", ["salad", "green salad", "side salad", "mixed salad"], ["lettuce", "cucumber", "tomato"], [
    ["lettuce", 1, "piece"], ["cucumber", 1, "piece"], ["tomato", 2, "piece"], ["carrot", 1, "piece"], ["olive-oil", 2, "tbsp"], ["lemon", 1, "piece"], ["salt", 0.25, "tsp"],
  ]),
  d("club-sandwich", "Club sandwich", "global", ["chicken club sandwich", "club sandwiches"], ["bread", "chicken", "bacon"], [
    ["bread", 6, "slice"], ["chicken", 200, "g"], ["bacon", 150, "g"], ["lettuce", 0.25, "piece"], ["tomato", 1, "piece"], ["mayo", 30, "g"],
  ]),
  d("grilled-cheese", "Grilled cheese", "global", ["grilled cheese sandwich", "cheese toastie", "toasted cheese sandwich"], ["bread", "cheddar"], [
    ["bread", 4, "slice"], ["cheddar", 100, "g"], ["butter", 30, "g"],
  ]),
  d("burgers", "Burgers", "global", ["burger", "beef burgers", "cheeseburgers", "hamburgers"], ["ground-beef", "burger-buns"], [
    ["ground-beef", 400, "g"], ["burger-buns", 2, "piece"], ["cheddar", 50, "g", "opt"], ["lettuce", 0.25, "piece"], ["tomato", 1, "piece"], ["onion", 1, "piece"], ["ketchup", 30, "g", "opt"], ["salt", 0.5, "tsp"],
  ]),
  d("veggie-burgers", "Veggie burgers", "global", ["veggie burger", "vegetarian burgers", "plant-based burgers"], ["veggie-patties", "burger-buns"], [
    ["veggie-patties", 2, "piece"], ["burger-buns", 2, "piece"], ["lettuce", 0.25, "piece"], ["tomato", 1, "piece"], ["onion", 1, "piece"], ["ketchup", 30, "g", "opt"],
  ]),
  d("chili-con-carne", "Chili con carne", "global", ["chili", "chilli con carne", "beef chili"], ["ground-beef", "kidney-beans-can", "canned-tomatoes"], [
    ["ground-beef", 400, "g"], ["kidney-beans-can", 400, "g"], ["canned-tomatoes", 400, "g"], ["onion", 1, "piece"], ["bell-pepper", 1, "piece"], ["garlic", 3, "clove"], ["chili-powder", 1, "tbsp"], ["cumin", 1, "tsp"], ["rice", 180, "g"], ["sour-cream", 50, "g", "opt"], ["oil", 1, "tbsp"], ["salt", 1, "tsp"],
  ]),
  d("tomato-soup", "Tomato soup", "global", ["cream of tomato soup", "tomato bisque"], ["tomato", "onion"], [
    ["tomato", 6, "piece"], ["onion", 1, "piece"], ["garlic", 2, "clove"], ["butter", 20, "g"], ["cream", 50, "ml", "opt"], ["veg-stock", 500, "ml"], ["bread", 4, "slice", "opt"], ["salt", 0.5, "tsp"],
  ]),
  d("chicken-noodle-soup", "Chicken noodle soup", "global", ["chicken soup", "chicken noodle"], ["chicken", "egg-noodles", "chicken-stock"], [
    ["chicken", 300, "g"], ["egg-noodles", 100, "g"], ["carrot", 2, "piece"], ["celery", 80, "g"], ["onion", 1, "piece"], ["chicken-stock", 1000, "ml"], ["parsley", 0.25, "bunch", "opt"], ["salt", 0.5, "tsp"],
  ]),
  d("minestrone", "Minestrone", "global", ["minestrone soup", "italian vegetable soup"], ["canned-tomatoes", "cannellini", "small-pasta"], [
    ["canned-tomatoes", 400, "g"], ["cannellini", 400, "g"], ["carrot", 1, "piece"], ["celery", 80, "g"], ["onion", 1, "piece"], ["zucchini", 1, "piece"], ["small-pasta", 60, "g"], ["veg-stock", 750, "ml"], ["parmesan", 20, "g", "opt"], ["olive-oil", 1, "tbsp"], ["salt", 0.5, "tsp"],
  ]),
  d("pizza-margherita", "Pizza margherita", "global", ["margherita pizza", "pizza", "homemade pizza"], ["pizza-dough", "mozzarella", "canned-tomatoes"], [
    ["pizza-dough", 1, "piece"], ["mozzarella", 200, "g"], ["canned-tomatoes", 200, "g"], ["basil", 0.25, "bunch"], ["olive-oil", 1, "tbsp"], ["salt", 0.25, "tsp"],
  ]),
  d("lasagna", "Lasagna", "global", ["lasagne", "beef lasagna"], ["lasagna-sheets", "ground-beef", "mozzarella"], [
    ["lasagna-sheets", 200, "g"], ["ground-beef", 400, "g"], ["canned-tomatoes", 400, "g"], ["onion", 1, "piece"], ["garlic", 2, "clove"], ["mozzarella", 200, "g"], ["ricotta", 250, "g"], ["parmesan", 40, "g"], ["olive-oil", 1, "tbsp"], ["salt", 1, "tsp"],
  ]),
  d("shakshuka", "Shakshuka", "global", ["shakshouka", "eggs in tomato sauce"], ["eggs", "canned-tomatoes"], [
    ["eggs", 4, "piece"], ["canned-tomatoes", 400, "g"], ["bell-pepper", 1, "piece"], ["onion", 1, "piece"], ["garlic", 2, "clove"], ["cumin", 1, "tsp"], ["paprika", 1, "tsp"], ["feta", 50, "g", "opt"], ["bread", 4, "slice", "opt"], ["olive-oil", 2, "tbsp"],
  ]),
  d("roast-chicken", "Roast chicken and vegetables", "global", ["roast chicken", "sheet pan chicken", "chicken traybake"], ["chicken", "potato", "carrot"], [
    ["chicken", 600, "g"], ["potato", 4, "piece"], ["carrot", 2, "piece"], ["onion", 1, "piece"], ["garlic", 4, "clove"], ["rosemary", 0.5, "bunch", "opt"], ["olive-oil", 3, "tbsp"], ["salt", 1, "tsp"],
  ]),
  d("salmon-rice", "Salmon with rice", "global", ["salmon", "baked salmon", "salmon and rice", "grilled salmon"], ["salmon", "rice"], [
    ["salmon", 300, "g"], ["rice", 180, "g"], ["lemon", 1, "piece"], ["broccoli", 1, "piece"], ["butter", 20, "g"], ["garlic", 2, "clove"], ["salt", 0.5, "tsp"],
  ]),
  d("fish-and-chips", "Fish and chips", "global", ["fish n chips", "fish & chips"], ["white-fish", "potato"], [
    ["white-fish", 400, "g"], ["potato", 3, "piece"], ["maida", 100, "g"], ["oil", 500, "ml"], ["lemon", 1, "piece", "opt"], ["baking-powder", 1, "tsp"], ["salt", 1, "tsp"],
  ]),
  d("pad-thai", "Pad thai", "global", ["phad thai", "pad thai noodles"], ["rice-noodles", "eggs", "peanuts"], [
    ["rice-noodles", 200, "g"], ["shrimp", 200, "g"], ["eggs", 2, "piece"], ["bean-sprouts", 100, "g"], ["peanuts", 40, "g"], ["spring-onion", 0.5, "bunch"], ["lime", 1, "piece"], ["tamarind", 30, "g"], ["fish-sauce", 2, "tbsp"], ["sugar", 1, "tbsp"], ["oil", 2, "tbsp"],
  ]),
  d("thai-green-curry", "Thai green curry", "global", ["green curry", "thai curry", "green chicken curry"], ["curry-paste", "coconut-milk", "chicken"], [
    ["chicken", 400, "g"], ["coconut-milk", 400, "ml"], ["curry-paste", 50, "g"], ["bell-pepper", 1, "piece"], ["basil", 0.25, "bunch", "opt"], ["fish-sauce", 1, "tbsp"], ["sugar", 1, "tsp"], ["rice", 180, "g"], ["oil", 1, "tbsp"],
  ]),
  d("ramen", "Ramen", "global", ["ramen noodles", "noodle soup", "instant ramen"], ["ramen", "eggs"], [
    ["ramen", 2, "piece"], ["eggs", 2, "piece"], ["spring-onion", 0.5, "bunch"], ["bok-choy", 2, "piece"], ["chicken-stock", 1000, "ml", "opt"], ["soy-sauce", 1, "tbsp"],
  ]),
  d("teriyaki-chicken", "Teriyaki chicken", "global", ["chicken teriyaki", "teriyaki bowl"], ["chicken", "teriyaki", "rice"], [
    ["chicken", 400, "g"], ["teriyaki", 80, "ml"], ["rice", 180, "g"], ["broccoli", 1, "piece"], ["sesame", 1, "tbsp", "opt"], ["oil", 1, "tbsp"],
  ]),
  d("hummus-pita", "Hummus and pita", "global", ["hummus", "houmous", "hummus with pita"], ["chickpeas-can", "tahini"], [
    ["chickpeas-can", 400, "g"], ["tahini", 45, "g"], ["lemon", 1, "piece"], ["garlic", 1, "clove"], ["olive-oil", 2, "tbsp"], ["pita", 4, "piece"], ["salt", 0.5, "tsp"],
  ]),
  d("avocado-toast", "Avocado toast", "global", ["avo toast", "avocado on toast"], ["avocado", "bread"], [
    ["bread", 4, "slice"], ["avocado", 2, "piece"], ["lemon", 1, "piece"], ["eggs", 2, "piece", "opt"], ["chili-flakes", 0.5, "tsp", "opt"], ["salt", 0.25, "tsp"],
  ]),
  d("oatmeal", "Oatmeal", "global", ["porridge", "overnight oats", "oats"], ["oats", "milk"], [
    ["oats", 100, "g"], ["milk", 400, "ml"], ["banana", 1, "piece"], ["honey", 2, "tbsp"], ["berries", 100, "g", "opt"],
  ]),
  d("baked-potatoes", "Baked potatoes", "global", ["jacket potatoes", "loaded baked potatoes", "baked potato"], ["potato"], [
    ["potato", 2, "piece"], ["butter", 30, "g"], ["sour-cream", 60, "g"], ["cheddar", 60, "g"], ["chives", 0.5, "bunch", "opt"], ["salt", 0.5, "tsp"],
  ]),
  d("bangers-and-mash", "Bangers and mash", "global", ["sausage and mash", "sausages and mash", "bangers & mash"], ["sausages", "potato"], [
    ["sausages", 400, "g"], ["potato", 4, "piece"], ["butter", 40, "g"], ["milk", 80, "ml"], ["onion", 1, "piece"], ["gravy-mix", 25, "g"], ["salt", 0.5, "tsp"],
  ]),
  d("fajitas", "Fajitas", "global", ["chicken fajitas", "fajita"], ["chicken", "bell-pepper", "tortillas"], [
    ["chicken", 400, "g"], ["bell-pepper", 2, "piece"], ["onion", 1, "piece"], ["tortillas", 6, "piece"], ["fajita-seasoning", 30, "g"], ["sour-cream", 60, "g", "opt"], ["lime", 1, "piece", "opt"], ["oil", 1, "tbsp"],
  ]),
  d("mushroom-risotto", "Mushroom risotto", "global", ["risotto", "risotto ai funghi"], ["arborio", "mushrooms", "parmesan"], [
    ["arborio", 180, "g"], ["mushrooms", 250, "g"], ["onion", 1, "piece"], ["garlic", 2, "clove"], ["veg-stock", 1000, "ml"], ["parmesan", 40, "g"], ["butter", 30, "g"], ["white-wine", 100, "ml", "opt"], ["olive-oil", 1, "tbsp"], ["salt", 0.5, "tsp"],
  ]),
  d("tofu-stir-fry", "Tofu stir-fry", "global", ["tofu stir fry", "stir fried tofu"], ["tofu", "soy-sauce"], [
    ["tofu", 400, "g"], ["broccoli", 1, "piece"], ["bell-pepper", 1, "piece"], ["garlic", 3, "clove"], ["ginger", 10, "g"], ["soy-sauce", 3, "tbsp"], ["cornstarch", 1, "tbsp"], ["oil", 2, "tbsp"], ["rice", 180, "g"],
  ]),
  d("shrimp-pasta", "Garlic shrimp pasta", "global", ["shrimp scampi", "prawn pasta", "garlic prawns pasta"], ["spaghetti", "shrimp", "garlic"], [
    ["spaghetti", 200, "g"], ["shrimp", 300, "g"], ["garlic", 5, "clove"], ["butter", 30, "g"], ["lemon", 1, "piece"], ["parsley", 0.25, "bunch", "opt"], ["chili-flakes", 0.5, "tsp"], ["olive-oil", 2, "tbsp"], ["salt", 0.5, "tsp"],
  ]),
  d("chicken-caesar-wrap", "Chicken wraps", "global", ["chicken wrap", "wraps", "chicken caesar wrap"], ["tortillas", "chicken"], [
    ["tortillas", 4, "piece"], ["chicken", 300, "g"], ["lettuce", 0.5, "piece"], ["tomato", 1, "piece"], ["mayo", 40, "g"], ["cheddar", 60, "g", "opt"],
  ]),
];

export const DISH_BY_ID = new Map(DISHES.map((x) => [x.id, x]));
