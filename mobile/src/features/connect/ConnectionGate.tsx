import { Redirect } from "expo-router";
import type { ReactNode } from "react";

import { useConnection } from "@/auth/ConnectionProvider";
import { StateView } from "@/components/StateView";

type ConnectionGateProps = {
  children: ReactNode;
};

export function ConnectionGate({ children }: ConnectionGateProps) {
  const { activeProfile, hydrated } = useConnection();

  if (!hydrated) {
    return <StateView kind="loading" title="Loading Symphony" />;
  }

  if (!activeProfile) {
    return <Redirect href="/connect" />;
  }

  return children;
}
