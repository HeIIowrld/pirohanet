import catalog from './seoul-places.json' with { type: 'json' };
import { distanceFrom, isKoreanPoint } from './naver.js';
import { findLocations, locationName } from './location.js';

// Area centres only shortlist records that still need geocoding and a walking route.
const centres = {
  gwanghwamun: [126.9767, 37.5734], seochon: [126.9697, 37.5791],
  anguk: [126.985, 37.5758], cityhall: [126.978, 37.567],
  sinchon: [126.9373, 37.5595], ewha: [126.9458, 37.559],
  yeonnam: [126.9247, 37.564], hongdae: [126.9247, 37.5565],
  yeonhui: [126.926, 37.5706], dongnimmun: [126.9591, 37.5727],
  sangam: [126.896, 37.5724], mangwon: [126.8986, 37.5516]
};
const coordinateCache = new Map();
const nearbyRadius = 2000;

function directoryEntry(place) {
  const { name, area, category, description } = place;
  return { name, area, category, description };
}

export function landmarkDirectory() {
  return catalog.map(directoryEntry);
}

export function catalogPlace(name) {
  return catalog.find(place => place.name === name);
}

export function catalogCandidates(origin, destination, available, fatigue, excluded) {
  return catalog.flatMap(place => {
    if (place.minStay > available || excluded.has(place.name) || (fatigue === 'normal' && place.effort > 3)) return [];
    const point = place.coordinate ?? centres[place.region];
    const distance = Math.min(distanceFrom(origin, point), distanceFrom(destination, point));
    return distance <= 1450 ? [{ place, score: distance + place.minStay * 35 + place.effort * 50 }] : [];
  }).sort((a, b) => a.score - b.score).slice(0, 6).map(entry => entry.place);
}

async function resolveLandmark(place, env) {
  if (isKoreanPoint(place.coordinate)) return place.coordinate;
  const cached = coordinateCache.get(place.name);
  if (cached && cached.until > Date.now()) return cached.value;
  const district = place.address?.match(/서울(?:특별시)?\s+(\S+구)/u)?.[1];
  const terms = [place.target, place.name].filter(Boolean).map(locationName);
  const value = (async () => {
    for (const query of new Set([place.target, place.name].filter(Boolean))) {
      const { places } = await findLocations(query, env);
      const eligible = places.filter(hit => !district || hit.address?.includes(district));
      const match = eligible.find(hit => terms.includes(locationName(hit.name))) ??
        eligible.find(hit => terms.some(term => term.length >= 4 && locationName(hit.name).includes(term)));
      if (match) return match.coordinate;
    }
    return null;
  })().catch(() => null);
  const entry = { value, until: Date.now() + 24 * 60 * 60_000 };
  coordinateCache.set(place.name, entry);
  const coordinate = await value;
  if (!coordinate) entry.until = Date.now() + 60_000;
  return coordinate;
}

export async function originLandmarks(origin, env = process.env) {
  const shortlisted = catalog
    .filter(place => distanceFrom(origin, place.coordinate ?? centres[place.region]) <= nearbyRadius + 900)
    .sort((a, b) => distanceFrom(origin, a.coordinate ?? centres[a.region]) - distanceFrom(origin, b.coordinate ?? centres[b.region]))
    .slice(0, 18);
  const results = await Promise.all(shortlisted.map(async place => {
    const coordinate = await resolveLandmark(place, env);
    if (!coordinate) return null;
    const distance = distanceFrom(origin, coordinate);
    return distance <= nearbyRadius ? { ...directoryEntry(place), distance: Math.round(distance) } : null;
  }));
  return results.filter(Boolean).sort((a, b) => a.distance - b.distance).slice(0, 8);
}
