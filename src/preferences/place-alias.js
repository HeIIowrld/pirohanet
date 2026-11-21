export function placeAliasKey(text) {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
