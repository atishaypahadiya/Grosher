# Instacart Online Grocery Shopping Dataset 2017

The three CSVs in this folder are not committed (`.gitignore`); fetch them yourself.

- **Source**: "The Instacart Online Grocery Shopping Dataset 2017", released by Instacart and distributed
  through the Kaggle competition *Instacart Market Basket Analysis*
  (https://www.kaggle.com/c/instacart-market-basket-analysis/data). Files used here: `products.csv`
  (49,688 rows: `product_id, product_name, aisle_id, department_id`), `aisles.csv` (134 rows),
  `departments.csv` (21 rows). The order files are not used.
- **Terms**: Instacart released the dataset for **non-commercial use** with attribution, under its dataset
  terms of use (as cited by the Kaggle competition rules). Cite it as: "The Instacart Online Grocery
  Shopping Dataset 2017", accessed from https://www.instacart.com/datasets/grocery-shopping-2017 on
  17 Oct 2026. Grosher uses only the product names and their aisle / department labels, as a catalog of
  grocery product names; no customer or order data is read. Anything commercial built on this repository
  must replace the imported catalog with data it has rights to.
- **How it is used**: `scripts/import-instacart.ts` turns `products.csv` into `demo/catalog.instacart.json`
  through the hand-written `aisle-map.json` (Instacart aisle → our shelf categories, department → our
  department), with no model involved. See CLAUDE.md, "Store data".
