import type { ReactNode } from "react";
import { ScrollView, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

type AppScreenProps = {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scroll?: boolean;
  testID?: string;
};

export function AppScreen({
  children,
  contentContainerStyle,
  scroll = false,
  testID,
}: AppScreenProps) {
  const { colors } = useAppTheme();

  if (scroll) {
    return (
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={[styles.safeArea, { backgroundColor: colors.bgBase }]}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
          keyboardShouldPersistTaps="handled"
          testID={testID}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[
        styles.safeArea,
        styles.content,
        { backgroundColor: colors.bgBase },
        contentContainerStyle,
      ]}
      testID={testID}
    >
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.md,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
  },
});
