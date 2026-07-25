import { router, useLocalSearchParams } from "expo-router";

import { useConnection } from "@/auth/ConnectionProvider";
import { pairHostOffer } from "@/features/connect/pair-host";
import { PairHostScreen } from "@/features/connect/PairHostScreen";

export default function PairRoute() {
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const { saveHostProfile } = useConnection();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const link = code ? `symphony://pair?${new URLSearchParams({ code }).toString()}` : "";

  return (
    <PairHostScreen
      autoPair={Boolean(link)}
      initialLink={link}
      onPaired={() => router.replace("/")}
      pairHost={(offer) => pairHostOffer(offer, saveHostProfile)}
    />
  );
}
