/** Bounded, single-edit candidates. Swapping adjacent letters counts as one typo. */
export function spellingVariants(input: string): string[] {
  const word = input.toLowerCase();
  if (!/^[a-z]{3,32}$/.test(word)) return [];
  const result = new Set<string>();
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  for (let index = 0; index <= word.length; index++) {
    for (const letter of alphabet) {
      result.add(word.slice(0, index) + letter + word.slice(index));
      if (index < word.length) result.add(word.slice(0, index) + letter + word.slice(index + 1));
    }
    if (index < word.length) result.add(word.slice(0, index) + word.slice(index + 1));
    if (index + 1 < word.length) result.add(word.slice(0, index) + word[index + 1] + word[index] + word.slice(index + 2));
  }
  result.delete(word);
  return [...result];
}
