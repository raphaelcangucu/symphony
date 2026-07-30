import { router } from "expo-router";
import { useState } from "react";

import { useConnection } from "@/auth/ConnectionProvider";
import { ConnectScreen } from "@/features/connect/ConnectScreen";
import { pairHostOffer } from "@/features/connect/pair-host";
import { PairHostScreen } from "@/features/connect/PairHostScreen";

export default function ConnectRoute() {
  const [legacy, setLegacy] = useState(false);
  const { saveHostProfile } = useConnection();

  if (legacy) return <ConnectScreen />;

  return (
    <PairHostScreen
      onPaired={() => router.replace("/")}
      onUseLegacy={() => setLegacy(true)}
      pairHost={(offer) => pairHostOffer(offer, saveHostProfile)}
    />
  );
}
