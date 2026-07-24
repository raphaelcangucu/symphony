import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useConnection } from "@/auth/ConnectionProvider";

export function QueryProvider({ children }: { children: ReactNode }) {
  const { activeProfile } = useConnection();
  const previousProfileId = useRef<string | null>(null);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: 1,
          },
        },
      }),
  );

  useEffect(() => {
    const nextProfileId = activeProfile?.id ?? null;
    const previous = previousProfileId.current;
    if (previous && previous !== nextProfileId) {
      client.removeQueries({
        queryKey: ["session-library", previous],
      });
    }
    previousProfileId.current = nextProfileId;
  }, [activeProfile?.id, client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
