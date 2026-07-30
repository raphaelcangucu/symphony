import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type CommitSheetProps = {
  busy: boolean;
  visible: boolean;
  onClose(): void;
  onCommit(message: string): void;
};

export function CommitSheet({ busy, visible, onClose, onCommit }: CommitSheetProps) {
  const { colors } = useAppTheme();
  const [message, setMessage] = useState("");
  const trimmedMessage = message.trim();
  useEffect(() => {
    if (!visible) setMessage("");
  }, [visible]);

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.bgRaised, borderColor: colors.borderSubtle },
          ]}
        >
          <View style={styles.headingRow}>
            <View style={styles.headingCopy}>
              <Text style={[styles.heading, { color: colors.textPrimary }]}>Commit changes</Text>
              <Text style={{ color: colors.textMuted }}>
                Review the message before creating commits in the changed repositories.
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Close commit sheet"
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={styles.close}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 24 }}>×</Text>
            </Pressable>
          </View>
          <TextInput
            accessibilityLabel="Commit message"
            autoCapitalize="sentences"
            editable={!busy}
            multiline
            onChangeText={setMessage}
            placeholder="feat: describe the change"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              {
                backgroundColor: colors.bgPanel,
                borderColor: colors.borderStrong,
                color: colors.textPrimary,
              },
            ]}
            value={message}
          />
          <Pressable
            accessibilityLabel="Confirm commit"
            accessibilityRole="button"
            disabled={busy || !trimmedMessage}
            onPress={() => {
              onCommit(trimmedMessage);
              setMessage("");
              onClose();
            }}
            style={[
              styles.confirm,
              {
                backgroundColor: busy || !trimmedMessage ? colors.bgPressed : colors.accent,
              },
            ]}
          >
            <Text
              style={{
                color: busy || !trimmedMessage ? colors.textMuted : colors.onAccent,
                fontWeight: "700",
              }}
            >
              {busy ? "Committing…" : "Confirm commit"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.55)",
    flex: 1,
    justifyContent: "flex-end",
  },
  close: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
  },
  confirm: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 48,
  },
  heading: { fontSize: 20, fontWeight: "700" },
  headingCopy: { flex: 1, gap: spacing.xxs },
  headingRow: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
  input: {
    borderRadius: radii.md,
    borderWidth: 1,
    minHeight: 96,
    padding: spacing.md,
    textAlignVertical: "top",
  },
  sheet: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
});
