import { dehydrate, hydrate, type Query, type QueryClient } from "@tanstack/react-query";

export type QueryCacheStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
};

export function profileQueryCacheKey(profileId: string): string {
  return `symphony.query-cache.v1.${encodeURIComponent(profileId)}`;
}

export async function saveProfileQueries(
  client: QueryClient,
  profileId: string,
  storage: QueryCacheStorage,
): Promise<void> {
  const state = dehydrate(client, {
    shouldDehydrateQuery: (query) =>
      query.state.status === "success" && queryBelongsToProfile(query, profileId),
  });
  await storage.setItem(profileQueryCacheKey(profileId), JSON.stringify(state));
}

export async function restoreProfileQueries(
  client: QueryClient,
  profileId: string,
  storage: QueryCacheStorage,
): Promise<void> {
  const serialized = await storage.getItem(profileQueryCacheKey(profileId));
  if (!serialized) return;
  try {
    const state: unknown = JSON.parse(serialized);
    hydrate(client, state);
  } catch {
    await storage.removeItem(profileQueryCacheKey(profileId));
  }
}

export function removeProfileQueries(client: QueryClient, profileId: string): void {
  client.removeQueries({
    predicate: (query) => queryBelongsToProfile(query, profileId),
  });
}

function queryBelongsToProfile(query: Query, profileId: string): boolean {
  return query.queryKey[0] === "host" && query.queryKey[1] === profileId;
}
