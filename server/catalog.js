import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fuse from 'fuse.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(path.join(here, 'data', 'catalog.json'), 'utf8'));

export const catalogMeta = raw.meta;
export const items = raw.items;

const fuse = new Fuse(items, {
  includeScore: true,
  threshold: 0.42,        // tolerant to typos: "intersteller" still finds Interstellar
  ignoreLocation: true,
  minMatchCharLength: 2,
  keys: [
    { name: 'title', weight: 0.6 },
    { name: 'genres', weight: 0.15 },
    { name: 'synopsis', weight: 0.1 },
    { name: 'platform', weight: 0.1 },
    { name: 'language', weight: 0.05 },
  ],
});

export const GENRES = [...new Set(items.flatMap((i) => i.genres))].sort();
export const PLATFORMS = [...new Set(items.map((i) => i.platform))].sort();
export const LANGUAGES = [...new Set(items.map((i) => i.language))].sort();

/** Top-N per genre, by rating. */
export function genreBoards(n = 10) {
  return GENRES.map((genre) => ({
    genre,
    items: items
      .filter((i) => i.genres.includes(genre))
      .sort((a, b) => b.rating - a.rating || b.year - a.year)
      .slice(0, n),
  })).filter((b) => b.items.length >= 5); // secondary tags like "Fantasy" are too thin for a board
}

export function search({ q, genre, platform, type, language, minRating, yearFrom, yearTo, sort = 'relevance', limit = 60 } = {}) {
  let results;
  if (q && q.trim()) {
    results = fuse.search(q.trim()).map((r) => ({ ...r.item, score: r.score }));
  } else {
    results = items.map((i) => ({ ...i, score: 0 }));
  }
  if (genre) results = results.filter((i) => i.genres.includes(genre));
  if (platform) results = results.filter((i) => i.platform === platform);
  if (type) results = results.filter((i) => i.type === type);
  if (language) results = results.filter((i) => i.language === language);
  if (minRating) results = results.filter((i) => i.rating >= Number(minRating));
  if (yearFrom) results = results.filter((i) => i.year >= Number(yearFrom));
  if (yearTo) results = results.filter((i) => i.year <= Number(yearTo));

  const sorters = {
    relevance: (a, b) => (q ? a.score - b.score : b.rating - a.rating),
    rating: (a, b) => b.rating - a.rating,
    year: (a, b) => b.year - a.year,
    title: (a, b) => a.title.localeCompare(b.title),
  };
  results.sort(sorters[sort] || sorters.relevance);
  return results.slice(0, limit);
}

export function byId(id) {
  return items.find((i) => i.id === id) || null;
}
