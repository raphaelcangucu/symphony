import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { encodePairingOffer, type PairingOfferV1 } from "@/auth/pairing-offer";
import { ThemeProvider } from "@/theme/ThemeProvider";

import { PairHostScreen } from "./PairHostScreen";

jest.mock("expo-camera", () => ({
  CameraView: "CameraView",
  useCameraPermissions: () => [{ granted: true }, jest.fn(async () => ({ granted: true }))],
}));

const offer: PairingOfferV1 = {
  v: 1,
  endpoint: "wss://mac-studio.test/mobile/rpc",
  hostId: "host_01",
  hostName: "Mac Studio",
  hostPublicKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  deviceId: "device_01",
  deviceToken: "device-secret",
  scope: "mobile",
  protocolMin: 1,
  protocolMax: 1,
};

describe("PairHostScreen", () => {
  it("parses a manual Orca-style offer and authenticates before reporting success", async () => {
    const pairHost = jest.fn(async () => undefined);
    const onPaired = jest.fn();
    renderScreen({ onPaired, pairHost });

    fireEvent.changeText(screen.getByLabelText("Pairing link"), encodePairingOffer(offer));
    fireEvent.press(screen.getByLabelText("Pair Symphony host"));

    await waitFor(() => expect(pairHost).toHaveBeenCalledWith(offer));
    expect(onPaired).toHaveBeenCalled();
  });

  it("retains the pairing draft and redacts its token when authentication fails", async () => {
    const link = encodePairingOffer(offer);
    const pairHost = jest.fn(async () => {
      throw new Error(`Could not authenticate ${offer.deviceToken}`);
    });
    renderScreen({ pairHost });

    fireEvent.changeText(screen.getByLabelText("Pairing link"), link);
    fireEvent.press(screen.getByLabelText("Pair Symphony host"));

    expect(await screen.findByText("Could not authenticate [REDACTED]")).toBeTruthy();
    expect(screen.getByDisplayValue(link)).toBeTruthy();
  });

  it("rejects a legacy connect link without discarding manual input", async () => {
    const input = "symphony://connect?url=https://legacy.test&token=secret";
    renderScreen({ pairHost: jest.fn() });

    fireEvent.changeText(screen.getByLabelText("Pairing link"), input);
    fireEvent.press(screen.getByLabelText("Pair Symphony host"));

    expect(await screen.findByText("Unsupported Symphony pairing link")).toBeTruthy();
    expect(screen.getByDisplayValue(input)).toBeTruthy();
  });
});

function renderScreen(props: React.ComponentProps<typeof PairHostScreen>) {
  return render(
    <ThemeProvider colorScheme="dark">
      <PairHostScreen {...props} />
    </ThemeProvider>,
  );
}
