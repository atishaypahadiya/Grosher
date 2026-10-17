import test from "node:test";
import assert from "node:assert/strict";
import { band, confirmed, daysSinceConfirmed, decayed, missed, withDecay } from "../src/confidence.ts";

const DAY = 86_400_000;
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("Got it: 30% of the gap toward 1, confirms+1, lastConfirmed", () => {
  const r = confirmed({ confidence: 0.5 }, 100);
  close(r.confidence!, 0.65);
  assert.equal(r.confirms, 1);
  assert.equal(r.lastConfirmed, 100);
  const again = confirmed(r, 200);
  close(again.confidence!, 0.755);
  assert.equal(again.confirms, 2);
  assert.equal(again.lastConfirmed, 200);
  close(confirmed({ confidence: 1, confirms: 3 }, 1).confidence!, 1); // never above 1
  close(confirmed({}, 1).confidence!, 1); // absent = 1 (a surveyed entry)
});

test("Not here: −0.3 with a floor of 0.05, misses+1, lastMissed", () => {
  const r = missed({ confidence: 0.9 }, 5);
  close(r.confidence!, 0.6);
  assert.equal(r.misses, 1);
  assert.equal(r.lastMissed, 5);
  close(missed(r, 6).confidence!, 0.3);
  const floored = missed(missed(r, 6), 7);
  close(floored.confidence!, 0.05);
  assert.equal(floored.misses, 3);
  close(missed({ confidence: 0.05 }, 8).confidence!, 0.05);
});

test("time decay: nothing for 90 days, then −0.1 per further 30 days, floor 0.4, never stored", () => {
  const r = { confidence: 0.9, lastConfirmed: 0 };
  close(decayed(r, 89 * DAY), 0.9);
  close(decayed(r, 90 * DAY), 0.9); // exactly 90 days: no further 30 days yet
  close(decayed(r, 119 * DAY), 0.9);
  close(decayed(r, 120 * DAY), 0.8); // one further 30-day period
  close(decayed(r, 150 * DAY), 0.7);
  close(decayed(r, 240 * DAY), 0.4); // floor
  close(decayed(r, 2000 * DAY), 0.4);
  close(decayed({ confidence: 0.3, lastConfirmed: 0 }, 400 * DAY), 0.3); // already below the floor: untouched
  close(decayed({ confidence: 0.9 }, 400 * DAY), 0.9); // never confirmed: no date to decay from
  close(decayed({}, 400 * DAY), 1);
  assert.equal(r.confidence, 0.9); // the record itself is untouched
  const shown = withDecay(r, 150 * DAY);
  close(shown.confidence!, 0.7);
  assert.equal(withDecay(r, 10 * DAY), r); // same object when nothing changed
  assert.equal(daysSinceConfirmed(r, 150 * DAY), 150);
  assert.equal(daysSinceConfirmed({}, 1), null);
});

test("bands: ≥ .8 confirmed, .5–.8 likely, < .5 guess; the edges belong to the higher band", () => {
  assert.equal(band(1), "confirmed");
  assert.equal(band(0.8), "confirmed");
  assert.equal(band(0.7999), "likely");
  assert.equal(band(0.5), "likely");
  assert.equal(band(0.4999), "guess");
  assert.equal(band(0), "guess");
});

test("a confirmed guess climbs: guess → likely → confirmed in three Got its from .45", () => {
  let r = { confidence: 0.45 };
  const bands = [band(r.confidence)];
  for (let i = 0; i < 3; i++) {
    r = confirmed(r, i);
    bands.push(band(r.confidence!));
  }
  assert.deepEqual(bands, ["guess", "likely", "likely", "confirmed"]);
});
