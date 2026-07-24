import { router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { createTrackerClient } from "@/api/client";
import { TrackerAuthError } from "@/api/errors";
import { normalizeTrackerOrigin, redactSecret } from "@/auth/connection-profile";
import { useConnection } from "@/auth/ConnectionProvider";
import { AppScreen } from "@/components/AppScreen";
import { BrandMark } from "@/components/BrandMark";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

export type ConnectionValidation = {
  health: { status: string };
  viewer: { id: string; name: string };
};

type ConnectScreenProps = {
  onConnected?: () => void;
  validateConnection?: (input: { origin: string; token: string }) => Promise<ConnectionValidation>;
};

export function ConnectScreen({
  onConnected,
  validateConnection = validateTrackerConnection,
}: ConnectScreenProps) {
  const { colors } = useAppTheme();
  const { saveProfile } = useConnection();
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const canSubmit = Boolean(name.trim() && origin.trim() && token.trim()) && !submitting;

  async function connect() {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const normalizedOrigin = normalizeTrackerOrigin(origin);
      const normalizedToken = token.trim();
      await validateConnection({
        origin: normalizedOrigin,
        token: normalizedToken,
      });
      await saveProfile({
        name: name.trim(),
        origin: normalizedOrigin,
        token: normalizedToken,
      });
      if (onConnected) onConnected();
      else router.replace("/");
    } catch (cause) {
      if (cause instanceof TrackerAuthError) {
        setError("Invalid tracker token");
      } else {
        const message = cause instanceof Error ? cause.message : "Could not connect to Symphony";
        setError(redactSecret(message, token));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AppScreen contentContainerStyle={styles.screen} scroll testID="connect-screen">
      <View style={styles.brand}>
        <BrandMark />
      </View>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Connect to Symphony</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          Add a reachable tracker and keep its token protected on this device.
        </Text>
      </View>

      <View style={styles.fields}>
        <Field
          autoCapitalize="words"
          label="Connection name"
          onChangeText={setName}
          placeholder="Remote"
          value={name}
        />
        <Field
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          label="Tracker URL"
          onChangeText={setOrigin}
          placeholder="https://symphony.example.com"
          value={origin}
        />
        <Field
          autoCapitalize="none"
          autoCorrect={false}
          label="Tracker token"
          onChangeText={setToken}
          placeholder="Paste your tracker token"
          secureTextEntry
          value={token}
        />
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.statusRed }]}>
          {error}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        onPress={() => void connect()}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: colors.textPrimary,
            opacity: !canSubmit ? 0.35 : pressed ? 0.78 : 1,
          },
        ]}
      >
        <Text style={[styles.buttonLabel, { color: colors.bgBase }]}>
          {submitting ? "Connecting…" : "Connect"}
        </Text>
      </Pressable>
    </AppScreen>
  );
}

type FieldProps = React.ComponentProps<typeof TextInput> & {
  label: string;
};

function Field({ label, ...props }: FieldProps) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        style={[
          styles.input,
          {
            backgroundColor: colors.bgPanel,
            borderColor: colors.borderStrong,
            color: colors.textPrimary,
          },
        ]}
        {...props}
      />
    </View>
  );
}

async function validateTrackerConnection(input: {
  origin: string;
  token: string;
}): Promise<ConnectionValidation> {
  const client = createTrackerClient({
    origin: input.origin,
    token: input.token,
    locale: resolvedLocale(),
  });
  const health = await client.health();
  const viewer = await client.viewer();
  return { health, viewer };
}

function resolvedLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en";
  } catch {
    return "en";
  }
}

const styles = StyleSheet.create({
  brand: {
    marginTop: spacing.xl,
  },
  button: {
    alignItems: "center",
    borderRadius: radii.pill,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 52,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: "800",
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 340,
  },
  error: {
    fontSize: 14,
    lineHeight: 20,
  },
  field: {
    gap: spacing.xs,
  },
  fields: {
    gap: spacing.md,
  },
  heading: {
    gap: spacing.xs,
    marginBottom: spacing.xl,
    marginTop: 56,
  },
  input: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
  },
  screen: {
    paddingBottom: spacing.xxl,
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
});
