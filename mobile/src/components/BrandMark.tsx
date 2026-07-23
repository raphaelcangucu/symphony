import { Image, StyleSheet, Text, View } from "react-native";

import { spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type BrandMarkProps = {
  compact?: boolean;
};

export function BrandMark({ compact = false }: BrandMarkProps) {
  const { colors } = useAppTheme();

  return (
    <View accessibilityLabel="Dev10x" accessibilityRole="image" style={styles.lockup}>
      <Image source={require("../../assets/icon.png")} style={styles.logo} />
      {compact ? null : (
        <Text style={[styles.wordmark, { color: colors.textPrimary }]}>Dev10x</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  logo: {
    height: 30,
    width: 30,
  },
  wordmark: {
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
});
