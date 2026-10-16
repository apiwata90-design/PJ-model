// JSON GET with timeout and retry. HF datasets-server answers 500 "index is loading" for a while
// after the dataset updates, so retries back off long enough to ride that out.

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function getJson(url, { timeoutMs = 30000, retries = 4, baseDelayMs = 5000, fetchImpl = fetch, retryStatuses = [429] } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': 'arena-first-rank-forecast/0.1', Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (res.ok) return JSON.parse(text);
      lastError = new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
      if (res.status < 500 && !retryStatuses.includes(res.status)) break;
    } catch (err) {
      lastError = err;
    }
    if (attempt < retries) await sleep(baseDelayMs * 2 ** attempt);
  }
  throw lastError;
}
