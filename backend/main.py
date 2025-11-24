from typing import List, Optional, Dict, Tuple
from math import radians, sin, cos, sqrt, atan2

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


app = FastAPI(
    title="Grosher – In-Store Navigator",
    description="V0 API for 'Google Maps for Stores' – trip + in-store route optimizer.",
    version="0.1.0",
)

# Enable CORS so frontend can talk to backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # React default port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------
# Data Models
# -----------------------------


class UserLocation(BaseModel):
    latitude: float
    longitude: float


class ShoppingListRequest(BaseModel):
    user_location: UserLocation
    shopping_list: List[str] = Field(..., description="List of item names, e.g. ['milk', 'eggs']")
    preferred_store_ids: Optional[List[str]] = Field(
        default=None,
        description="Optional list of store IDs to consider. For V0, we use a single sample store.",
    )


class RouteStep(BaseModel):
    step_type: str  # "enter", "item", "checkout"
    description: str
    x: float
    y: float
    item_name: Optional[str] = None


class ItemAvailability(BaseModel):
    name: str
    available: bool
    price: Optional[float] = None
    store_id: Optional[str] = None


class StoreSummary(BaseModel):
    store_id: str
    store_name: str
    store_lat: float
    store_lon: float
    total_price: float
    all_items_available: bool
    available_items: List[ItemAvailability]
    missing_items: List[ItemAvailability]
    driving_distance_km: float
    driving_time_min: float
    in_store_distance_m: float
    in_store_time_min: float
    estimated_checkout_time_min: float
    total_trip_time_min: float
    route_steps: List[RouteStep]


class OptimizeTripResponse(BaseModel):
    best_store: StoreSummary
    considered_stores: List[StoreSummary]


# -----------------------------
# Sample Store Data (V0)
# In reality, this would come from DB + APIs.
# -----------------------------


class Store:
    def __init__(
        self,
        store_id: str,
        name: str,
        latitude: float,
        longitude: float,
        entrance: Tuple[float, float],
        checkout: Tuple[float, float],
        inventory: Dict[str, Dict],
    ):
        self.store_id = store_id
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.entrance = entrance
        self.checkout = checkout
        self.inventory = inventory


# Coordinate units are arbitrary; we'll treat 1 unit ≈ 2 meters in V0.
WALMART_SAN_JOSE = Store(
    store_id="walmart_sanjose_001",
    name="Walmart Supercenter – San Jose",
    latitude=37.3355,
    longitude=-121.8811,
    entrance=(0.0, 0.0),
    checkout=(0.0, 20.0),
    inventory={
        "milk": {"price": 3.49, "location": (5.0, 5.0)},
        "eggs": {"price": 2.99, "location": (8.0, 6.0)},
        "bread": {"price": 2.49, "location": (4.0, 10.0)},
        "chicken": {"price": 7.99, "location": (10.0, 14.0)},
        "rice": {"price": 12.99, "location": (2.0, 16.0)},
        "pasta": {"price": 1.99, "location": (6.0, 15.0)},
        "toothpaste": {"price": 4.49, "location": (12.0, 5.0)},
        "shampoo": {"price": 6.99, "location": (14.0, 8.0)},
        "apples": {"price": 4.99, "location": (3.0, 3.0)},
        "bananas": {"price": 1.99, "location": (3.5, 3.5)},
        "cereal": {"price": 4.99, "location": (7.0, 12.0)},
        "coffee": {"price": 8.99, "location": (9.0, 11.0)},
    },
)

TARGET_SAN_JOSE = Store(
    store_id="target_sanjose_001",
    name="Target – San Jose",
    latitude=37.3387,
    longitude=-121.8853,
    entrance=(0.0, 0.0),
    checkout=(0.0, 18.0),
    inventory={
        "milk": {"price": 3.99, "location": (6.0, 4.0)},
        "eggs": {"price": 3.49, "location": (7.0, 5.0)},
        "bread": {"price": 2.99, "location": (5.0, 9.0)},
        "chicken": {"price": 8.49, "location": (11.0, 13.0)},
        "rice": {"price": 13.49, "location": (3.0, 15.0)},
        "pasta": {"price": 2.29, "location": (5.0, 14.0)},
        "toothpaste": {"price": 4.99, "location": (13.0, 6.0)},
        "shampoo": {"price": 7.49, "location": (15.0, 7.0)},
        "apples": {"price": 5.49, "location": (4.0, 2.0)},
        "cereal": {"price": 5.49, "location": (8.0, 11.0)},
        "coffee": {"price": 9.99, "location": (10.0, 10.0)},
    },
)

STORES: Dict[str, Store] = {
    WALMART_SAN_JOSE.store_id: WALMART_SAN_JOSE,
    TARGET_SAN_JOSE.store_id: TARGET_SAN_JOSE,
}


# -----------------------------
# Utility Functions
# -----------------------------


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Approximate distance between two lat/lon points in kilometers."""
    R = 6371.0  # Earth radius in km

    d_lat = radians(lat2 - lat1)
    d_lon = radians(lon2 - lon1)

    a = (
        sin(d_lat / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lon / 2) ** 2
    )
    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    return R * c


def estimate_drive(lat1: float, lon1: float, lat2: float, lon2: float) -> Tuple[float, float]:
    """Estimate driving distance/time using haversine + average city speed."""
    dist_km = haversine_distance_km(lat1, lon1, lat2, lon2)
    avg_speed_kmh = 35.0  # rough city average; replace with Google Maps API later
    time_hours = dist_km / avg_speed_kmh if avg_speed_kmh > 0 else 0
    time_min = time_hours * 60
    return dist_km, time_min


def euclidean_distance(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    x1, y1 = p1
    x2, y2 = p2
    return ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5


def optimize_in_store_route(
    store: Store, item_locations: Dict[str, Tuple[float, float]]
) -> Tuple[List[RouteStep], float]:
    """
    Very simple nearest-neighbor route:
    - Start at entrance
    - Visit nearest unvisited item
    - End at checkout
    Returns (route_steps, total_distance_units)
    """
    current = store.entrance
    remaining = item_locations.copy()
    steps: List[RouteStep] = []

    # Step: enter
    steps.append(
        RouteStep(
            step_type="enter",
            description=f"Enter {store.name} through main entrance.",
            x=current[0],
            y=current[1],
        )
    )

    total_distance_units = 0.0

    # Visit each item using nearest-neighbor heuristic
    while remaining:
        # find nearest item
        nearest_item = None
        nearest_dist = float("inf")
        for item_name, loc in remaining.items():
            d = euclidean_distance(current, loc)
            if d < nearest_dist:
                nearest_dist = d
                nearest_item = item_name

        if nearest_item is None:
            break

        # move to that item
        target_loc = remaining[nearest_item]
        total_distance_units += nearest_dist
        current = target_loc

        steps.append(
            RouteStep(
                step_type="item",
                description=f"Pick up '{nearest_item}' here.",
                x=current[0],
                y=current[1],
                item_name=nearest_item,
            )
        )

        # remove from remaining
        remaining.pop(nearest_item)

    # Go to checkout
    d_to_checkout = euclidean_distance(current, store.checkout)
    total_distance_units += d_to_checkout
    current = store.checkout

    steps.append(
        RouteStep(
            step_type="checkout",
            description="Proceed to checkout and pay.",
            x=current[0],
            y=current[1],
        )
    )

    return steps, total_distance_units


def estimate_in_store_time(
    distance_units: float,
    num_items: int,
    unit_to_meter: float = 2.0,
) -> Tuple[float, float, float]:
    """
    Convert in-store route to:
    - distance in meters
    - walking time in minutes
    - checkout time in minutes
    """
    distance_m = distance_units * unit_to_meter

    # avg walking speed ~ 1.3 m/s
    walking_speed_m_per_s = 1.3
    walking_time_s = distance_m / walking_speed_m_per_s if walking_speed_m_per_s > 0 else 0
    walking_time_min = walking_time_s / 60.0

    # Rough checkout + item handling estimation
    per_item_handling_min = 0.5
    base_checkout_min = 4.0
    checkout_time_min = base_checkout_min + per_item_handling_min * num_items

    return distance_m, walking_time_min, checkout_time_min


def evaluate_store_for_list(
    store: Store, request: ShoppingListRequest
) -> StoreSummary:
    # Availability + pricing
    available_items: List[ItemAvailability] = []
    missing_items: List[ItemAvailability] = []
    item_locations: Dict[str, Tuple[float, float]] = {}
    total_price = 0.0

    for raw_name in request.shopping_list:
        name = raw_name.strip().lower()
        inv = store.inventory.get(name)
        if inv:
            price = float(inv["price"])
            total_price += price
            available_items.append(
                ItemAvailability(
                    name=name,
                    available=True,
                    price=price,
                    store_id=store.store_id,
                )
            )
            item_locations[name] = inv["location"]
        else:
            missing_items.append(
                ItemAvailability(
                    name=name,
                    available=False,
                    price=None,
                    store_id=None,
                )
            )

    # In-store route
    if item_locations:
        route_steps, distance_units = optimize_in_store_route(store, item_locations)
        in_store_distance_m, in_store_time_min, checkout_time_min = estimate_in_store_time(
            distance_units, num_items=len(item_locations)
        )
    else:
        # Nothing available, but still define defaults
        route_steps = []
        in_store_distance_m = 0.0
        in_store_time_min = 0.0
        checkout_time_min = 0.0

    # Driving estimates (round trip)
    drive_dist_one_way_km, drive_time_one_way_min = estimate_drive(
        request.user_location.latitude,
        request.user_location.longitude,
        store.latitude,
        store.longitude,
    )
    driving_distance_km = drive_dist_one_way_km * 2  # round trip
    driving_time_min = drive_time_one_way_min * 2

    total_trip_time_min = driving_time_min + in_store_time_min + checkout_time_min

    return StoreSummary(
        store_id=store.store_id,
        store_name=store.name,
        store_lat=store.latitude,
        store_lon=store.longitude,
        total_price=round(total_price, 2),
        all_items_available=len(missing_items) == 0 and len(available_items) > 0,
        available_items=available_items,
        missing_items=missing_items,
        driving_distance_km=round(driving_distance_km, 2),
        driving_time_min=round(driving_time_min, 1),
        in_store_distance_m=round(in_store_distance_m, 1),
        in_store_time_min=round(in_store_time_min, 1),
        estimated_checkout_time_min=round(checkout_time_min, 1),
        total_trip_time_min=round(total_trip_time_min, 1),
        route_steps=route_steps,
    )


# -----------------------------
# API Endpoints
# -----------------------------


@app.get("/")
def root():
    return {"message": "Grosher API is running! Visit /docs for API documentation."}


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/stores")
def get_stores():
    """Get list of all available stores"""
    return {
        "stores": [
            {
                "store_id": store.store_id,
                "name": store.name,
                "latitude": store.latitude,
                "longitude": store.longitude,
            }
            for store in STORES.values()
        ]
    }


@app.post("/optimize-trip", response_model=OptimizeTripResponse)
def optimize_trip(request: ShoppingListRequest):
    if not request.shopping_list:
        raise HTTPException(status_code=400, detail="Shopping list cannot be empty.")
    
    # Deduplicate and clean
    unique_items = list(set(item.strip().lower() for item in request.shopping_list if item.strip()))
    
    if not unique_items:
        raise HTTPException(status_code=400, detail="No valid items in shopping list.")

    # Choose which stores to evaluate
    if request.preferred_store_ids:
        candidate_stores = []
        for sid in request.preferred_store_ids:
            s = STORES.get(sid)
            if not s:
                raise HTTPException(status_code=404, detail=f"Store '{sid}' not found.")
            candidate_stores.append(s)
    else:
        candidate_stores = list(STORES.values())

    if not candidate_stores:
        raise HTTPException(status_code=500, detail="No stores configured in the system.")

    # Update request with cleaned list
    request.shopping_list = unique_items

    # Evaluate all stores
    summaries: List[StoreSummary] = [
        evaluate_store_for_list(store, request) for store in candidate_stores
    ]

    # Choose "best" store:
    # 1. all items available
    # 2. lowest total_trip_time_min
    # 3. tie-breaker: lowest total_price
    def store_sort_key(s: StoreSummary):
        all_available_flag = 0 if s.all_items_available else 1  # 0 is better
        return (all_available_flag, s.total_trip_time_min, s.total_price)

    best = sorted(summaries, key=store_sort_key)[0]

    return OptimizeTripResponse(
        best_store=best,
        considered_stores=summaries,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)