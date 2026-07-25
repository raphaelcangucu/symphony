import { Pressable, StyleSheet, Text, View } from "react-native";

import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type RootMenuProps = {
  onClose(): void;
  onOpenConnections(): void;
  onOpenDiagnostics(): void;
  onOpenNotifications(): void;
  onOpenSettings(): void;
  onOpenTasks(): void;
};

export function RootMenu({
  onClose,
  onOpenConnections,
  onOpenDiagnostics,
  onOpenNotifications,
  onOpenSettings,
  onOpenTasks,
}: RootMenuProps) {
  const { colors } = useAppTheme();
  const actions = [
    ["Tasks", onOpenTasks],
    ["Connections", onOpenConnections],
    ["Notifications", onOpenNotifications],
    ["Diagnostics", onOpenDiagnostics],
    ["Settings", onOpenSettings],
  ] as const;

  return (
    <View
      accessibilityRole="menu"
      testID="root-menu"
      style={[styles.menu, { backgroundColor: colors.bgRaised, borderColor: colors.borderStrong }]}
    >
      {actions.map(([label, action]) => (
        <Pressable
          accessibilityRole="button"
          key={label}
          onPress={() => {
            onClose();
            action();
          }}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: pressed ? colors.bgPressed : colors.bgRaised },
          ]}
        >
          <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  label: { fontSize: 16, fontWeight: "600" },
  menu: {
    borderRadius: radii.md,
    borderWidth: 1,
    left: spacing.md,
    minWidth: 220,
    paddingVertical: spacing.xs,
    position: "absolute",
    top: 64,
    zIndex: 20,
  },
});
