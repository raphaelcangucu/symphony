import { CameraView, useCameraPermissions } from "expo-camera";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { parsePairingOffer, redactPairingSecrets, type PairingOfferV1 } from "@/auth/pairing-offer";
import { AppScreen } from "@/components/AppScreen";
import { BrandMark } from "@/components/BrandMark";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type PairHostScreenProps = {
  pairHost: (offer: PairingOfferV1) => Promise<void>;
  initialLink?: string;
  autoPair?: boolean;
  onPaired?: () => void;
  onUseLegacy?: () => void;
};

export function PairHostScreen({
  autoPair = false,
  initialLink = "",
  onPaired,
  onUseLegacy,
  pairHost,
}: PairHostScreenProps) {
  const { colors } = useAppTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [link, setLink] = useState(autoPair ? "" : initialLink);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const submittingRef = useRef(false);
  const autoSubmittedRef = useRef(false);

  const submitPairingLink = useCallback(
    async (candidate: string) => {
      if (!candidate.trim() || submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      setError(null);

      let offer: PairingOfferV1 | null = null;
      try {
        offer = parsePairingOffer(candidate);
        await pairHost(offer);
        onPaired?.();
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Could not pair this Symphony host";
        setError(offer ? redactPairingSecrets(message, offer) : message);
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [onPaired, pairHost],
  );

  useEffect(() => {
    if (!autoPair || !initialLink.trim() || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    void submitPairingLink(initialLink);
  }, [autoPair, initialLink, submitPairingLink]);

  async function openScanner() {
    const result = permission?.granted ? permission : await requestPermission();
    if (!result.granted) {
      setError("Camera access is required to scan a pairing QR code");
      return;
    }
    setError(null);
    setScanning(true);
  }

  return (
    <AppScreen contentContainerStyle={styles.screen} scroll testID="pair-host-screen">
      <View style={styles.brand}>
        <BrandMark />
      </View>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Pair a Symphony host</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          Scan the QR shown by the Symphony machine. This device receives its own revocable
          credential and pins that host’s encryption key.
        </Text>
      </View>

      {scanning ? (
        <View style={[styles.scannerFrame, { borderColor: colors.borderStrong }]}>
          <CameraView
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => {
              setLink(data);
              setScanning(false);
            }}
            style={StyleSheet.absoluteFill}
          />
          <Pressable
            accessibilityLabel="Cancel QR scan"
            onPress={() => setScanning(false)}
            style={[styles.scannerCancel, { backgroundColor: colors.bgPanel }]}
          >
            <Text style={{ color: colors.textPrimary, fontWeight: "700" }}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityLabel="Scan pairing QR code"
          onPress={() => void openScanner()}
          style={[styles.secondaryButton, { borderColor: colors.borderStrong }]}
        >
          <Text style={{ color: colors.textPrimary, fontWeight: "700" }}>Scan QR code</Text>
        </Pressable>
      )}

      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Or paste the pairing link
        </Text>
        <TextInput
          accessibilityLabel="Pairing link"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          onChangeText={setLink}
          placeholder="symphony://pair?code=…"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            {
              backgroundColor: colors.bgPanel,
              borderColor: colors.borderStrong,
              color: colors.textPrimary,
            },
          ]}
          value={link}
        />
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.statusRed }]}>
          {error}
        </Text>
      ) : null}

      <Pressable
        accessibilityLabel="Pair Symphony host"
        accessibilityState={{ disabled: !link.trim() || submitting }}
        disabled={!link.trim() || submitting}
        onPress={() => void submitPairingLink(link)}
        style={({ pressed }) => [
          styles.primaryButton,
          {
            backgroundColor: colors.textPrimary,
            opacity: !link.trim() || submitting ? 0.35 : pressed ? 0.78 : 1,
          },
        ]}
      >
        <Text style={{ color: colors.bgBase, fontWeight: "800" }}>
          {submitting ? "Authenticating…" : "Pair host"}
        </Text>
      </Pressable>

      {onUseLegacy ? (
        <Pressable accessibilityLabel="Use legacy tracker connection" onPress={onUseLegacy}>
          <Text style={[styles.legacy, { color: colors.textMuted }]}>
            Use a legacy tracker connection
          </Text>
        </Pressable>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  brand: { marginTop: spacing.xl },
  description: { fontSize: 15, lineHeight: 22, maxWidth: 360 },
  error: { fontSize: 14, lineHeight: 20 },
  field: { gap: spacing.xs },
  heading: { gap: spacing.xs, marginBottom: spacing.lg, marginTop: 56 },
  input: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 14,
    minHeight: 96,
    padding: spacing.md,
    textAlignVertical: "top",
  },
  label: { fontSize: 13, fontWeight: "700" },
  legacy: { fontSize: 13, textAlign: "center", textDecorationLine: "underline" },
  primaryButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: 52,
  },
  scannerCancel: {
    alignSelf: "center",
    borderRadius: radii.pill,
    bottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: "absolute",
  },
  scannerFrame: {
    borderRadius: radii.lg,
    borderWidth: 1,
    height: 280,
    overflow: "hidden",
  },
  screen: { gap: spacing.md, paddingBottom: spacing.xxl },
  secondaryButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 50,
  },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -0.8 },
});
