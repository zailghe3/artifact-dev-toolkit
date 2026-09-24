type CachedEvidence = { expiresAt: number; value: unknown };

export class InfrastructureFreshnessEvidenceCache {
  private readonly completed = new Map<string, CachedEvidence>();
  private readonly inFlight = new Map<string, Promise<unknown | undefined>>();
  private readonly ttlMs: number;
  private generation = 0;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(
    key: string,
    load: () => Promise<unknown | undefined>,
    now = Date.now(),
  ): Promise<unknown | undefined> {
    const cached = this.completed.get(key);
    if (cached && cached.expiresAt > now) return Promise.resolve(cached.value);
    this.completed.delete(key);

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const generation = this.generation;
    const request = load()
      .then((value) => {
        if (value !== undefined && generation === this.generation) {
          this.completed.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        }
        return value;
      }, () => undefined)
      .finally(() => {
        if (this.inFlight.get(key) === request) this.inFlight.delete(key);
      });
    this.inFlight.set(key, request);
    return request;
  }

  clear() {
    this.generation++;
    this.completed.clear();
    this.inFlight.clear();
  }
}
