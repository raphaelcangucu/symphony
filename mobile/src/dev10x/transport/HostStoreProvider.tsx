import { useEffect, type ReactNode } from "react";

import { useConnection } from "@/auth/ConnectionProvider";

import { bindConnectionHostStore, unbindConnectionHostStore } from "./host-store";

export function HostStoreProvider({ children }: { children: ReactNode }) {
  const connection = useConnection();

  bindConnectionHostStore(connection);
  useEffect(() => {
    const binding = bindConnectionHostStore(connection);
    return () => unbindConnectionHostStore(binding);
  }, [connection]);

  return children;
}
