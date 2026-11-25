const DOMAIN_PREFIX = /^[\[［【(]\s*[^\]］】)]{1,8}\s*[\]］】)]/u;

function meaningKey(value: string) {
  return value.normalize("NFKC").replace(DOMAIN_PREFIX, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function isMeaningNoise(value: string, options: { dropDomainSenses?: boolean } = {}) {
  const text = value.normalize("NFKC").trim();
  return (options.dropDomainSenses ?? true) && DOMAIN_PREFIX.test(text)
    || /计算机辅助|(?:DOS|Unix|Linux|Windows)\s*(?:内部命令|命令)/iu.test(text);
}

export function cleanMeaningParts(values: string[], options: { dropDomainSenses?: boolean } = {}) {
  const seen = new Set<string>();
  return values
    .map((item) => item.trim())
    .filter((item) => {
      const key = meaningKey(item);
      if (!key || isMeaningNoise(item, options) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Deduplicates local-dictionary translations while keeping their first display form. */
export function dedupeMeaningText(value: string) {
  return cleanMeaningParts(
    value.split(/[\r\n;,，；]+/u),
  ).join("；");
}
