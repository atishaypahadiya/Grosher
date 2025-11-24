import React, { useState } from 'react';
import './App.css';

function formatMinutes(min) {
  if (!Number.isFinite(min)) return '-';
  if (min < 120) return `${min.toFixed(1)} min`;
  const hours = min / 60;
  if (hours < 24) return `${hours.toFixed(1)} hr`;
  const days = hours / 24;
  return `${days.toFixed(1)} days`;
}

function App() {
  const [shoppingList, setShoppingList] = useState('');
  const [userLat, setUserLat] = useState('37.3382');
  const [userLon, setUserLon] = useState('-121.8863');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleOptimize = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    const items = shoppingList
      .split('\n')
      .map(item => item.trim())
      .filter(item => item.length > 0);

    if (items.length === 0) {
      setError('Please enter at least one item');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('http://localhost:8000/optimize-trip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_location: {
            latitude: parseFloat(userLat),
            longitude: parseFloat(userLon),
          },
          shopping_list: items,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to optimize trip');
      }

      const data = await response.json();
      // Force minimum loading time of 1s
await new Promise(resolve => setTimeout(resolve, 1000));
      setResult(data);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleGetLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLat(position.coords.latitude.toFixed(4));
          setUserLon(position.coords.longitude.toFixed(4));
        },
        () => {
          setError('Unable to get your location. Please enter it manually.');
        }
      );
    } else {
      setError('Geolocation is not supported by your browser.');
    }
  };

  const bestStore = result?.best_store;

  return (
    <div className="App">
      {loading && (
        <div className="loading-overlay">
          <div className="loading-box">
            <div className="spinner" />
            <div className="loading-title">Optimizing your grocery run…</div>
            <div className="loading-subtitle">
              Finding the best store and in-store route.
            </div>
          </div>
        </div>
      )}
      <header className="App-header">
        <div className="brand">
          <span className="brand-icon">🛒</span>
          <span className="brand-text">Grosher</span>
        </div>
        <p className="tagline">Google Maps for Aisles</p>
        <p className="subtagline">V0 · Local demo using sample Walmart + Target layouts</p>
      </header>

      <main className="main-layout">
        <section className="input-section">
          <div className="input-header">
            <h2>Your Shopping Run</h2>
            <span className="input-badge">Step 1 · Plan</span>
          </div>

          <div className="input-grid">
            <div className="input-block">
              <label className="field-label">Shopping list</label>
              <textarea
                value={shoppingList}
                onChange={(e) => setShoppingList(e.target.value)}
                placeholder={`Enter items (one per line):
milk
eggs
bread
chicken
rice`}
                rows="10"
              />
              <p className="field-hint">
                Tip: one item per line · we’ll deduplicate and clean it for you.
              </p>
            </div>

            <div className="input-block">
              <label className="field-label">Your location</label>
              <div className="location-inputs">
                <div className="field-group">
                  <span className="field-caption">Latitude</span>
                  <input
                    type="text"
                    value={userLat}
                    onChange={(e) => setUserLat(e.target.value)}
                    placeholder="Latitude"
                  />
                </div>
                <div className="field-group">
                  <span className="field-caption">Longitude</span>
                  <input
                    type="text"
                    value={userLon}
                    onChange={(e) => setUserLon(e.target.value)}
                    placeholder="Longitude"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleGetLocation}
                  className="location-btn"
                >
                  📍 Use my location
                </button>
              </div>

              <button
                onClick={handleOptimize}
                disabled={loading}
                className="optimize-btn"
              >
                {loading ? 'Optimizing route…' : '🚀 Optimize my trip'}
              </button>

              {error && <div className="error">{error}</div>}
            </div>
          </div>
        </section>

        {bestStore && (
          <section className="results-section">
            <div className="results-header">
              <div>
                <h2>🏆 Best option</h2>
                <p className="results-subtitle">{bestStore.store_name}</p>
              </div>
              <div className="pill">
                {bestStore.all_items_available
                  ? 'All items available in this store'
                  : 'Some items missing · optimized for time + cost'}
              </div>
            </div>

            <div className="summary-cards">
              <div className="card">
                <div className="card-label">Total cost</div>
                <div className="card-value">${bestStore.total_price}</div>
              </div>

              <div className="card">
                <div className="card-label">Total Trip Time</div>
                <div className="card-value">{formatMinutes(bestStore.total_trip_time_min)}</div>
              </div>

              <div className="card">
                <div className="card-label">Drive Time (round trip)</div>
                <div className="card-value">{formatMinutes(bestStore.driving_time_min)}</div>
              </div>

              <div className="card">
                <div className="card-label">In-store Time</div>
                <div className="card-value">
                  {formatMinutes(
                    bestStore.in_store_time_min +
                    bestStore.estimated_checkout_time_min
                  )}
                </div>
              </div>
            </div>

            <div className="results-grid">
              <div className="items-panel">
                <div className="items-section">
                  <h3>✅ Available items ({bestStore.available_items.length})</h3>
                  <div className="items-list">
                    {bestStore.available_items.map((item, idx) => (
                      <div key={idx} className="item">
                        <span className="item-name">{item.name}</span>
                        <span className="item-price">${item.price}</span>
                      </div>
                    ))}
                  </div>

                  {bestStore.missing_items.length > 0 && (
                    <>
                      <h3>❌ Not available ({bestStore.missing_items.length})</h3>
                      <div className="items-list missing">
                        {bestStore.missing_items.map((item, idx) => (
                          <div key={idx} className="item">
                            <span className="item-name">{item.name}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {result.considered_stores.length > 1 && (
                  <div className="comparison-section">
                    <h2>📊 Other options</h2>
                    {result.considered_stores
                      .filter(store => store.store_id !== bestStore.store_id)
                      .map((store, idx) => (
                        <div key={idx} className="store-card">
                          <h3>{store.store_name}</h3>
                          <div className="store-stats">
                            <span>💵 ${store.total_price}</span>
                            <span>⏱️ {formatMinutes(store.total_trip_time_min)}</span>
                            <span>
                              ✅ {store.available_items.length}/
                              {store.available_items.length + store.missing_items.length} items
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <div className="route-panel">
                <div className="route-section">
                  <h3>📍 In-store route</h3>
                  <p className="route-note">
                    Nearest-neighbour path from entrance → items → checkout. In a real V1,
                    this would sync with store aisle maps.
                  </p>

                  <div className="route-steps">
                    {bestStore.route_steps.map((step, idx) => (
                      <div key={idx} className={`route-step ${step.step_type}`}>
                        <div className="step-number">{idx + 1}</div>
                        <div className="step-content">
                          <div className="step-description">{step.description}</div>
                          {step.item_name && (
                            <div className="step-item">Item: {step.item_name}</div>
                          )}
                          <div className="step-coords">
                            Position: ({step.x.toFixed(1)}, {step.y.toFixed(1)})
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="store-map">
                    <svg width="400" height="500" viewBox="-5 -5 25 30">
                      <defs>
                        <pattern id="grid" width="2" height="2" patternUnits="userSpaceOnUse">
                          <path
                            d="M 2 0 L 0 0 0 2"
                            fill="none"
                            stroke="#e0e0e0"
                            strokeWidth="0.1"
                          />
                        </pattern>
                      </defs>
                      <rect x="-5" y="-5" width="30" height="35" fill="url(#grid)" />

                      <polyline
                        points={bestStore.route_steps.map(s => `${s.x},${s.y}`).join(' ')}
                        fill="none"
                        stroke="#4CAF50"
                        strokeWidth="0.3"
                        strokeLinecap="round"
                      />

                      {bestStore.route_steps.map((step, idx) => (
                        <g key={idx}>
                          <circle
                            cx={step.x}
                            cy={step.y}
                            r={
                              step.step_type === 'enter'
                                ? 0.8
                                : step.step_type === 'checkout'
                                ? 0.8
                                : 0.5
                            }
                            fill={
                              step.step_type === 'enter'
                                ? '#2196F3'
                                : step.step_type === 'checkout'
                                ? '#FF5722'
                                : '#4CAF50'
                            }
                            stroke="white"
                            strokeWidth="0.2"
                          />
                          <text
                            x={step.x}
                            y={step.y - 1}
                            fontSize="1"
                            textAnchor="middle"
                            fill="#333"
                          >
                            {idx === 0
                              ? '🚪'
                              : idx === bestStore.route_steps.length - 1
                              ? '💳'
                              : idx}
                          </text>
                        </g>
                      ))}
                    </svg>
                    <div className="map-legend">
                      <div><span className="legend-dot entrance"></span> Entrance</div>
                      <div><span className="legend-dot item"></span> Items</div>
                      <div><span className="legend-dot checkout"></span> Checkout</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;