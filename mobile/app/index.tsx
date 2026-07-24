import { StyleSheet, Text, View } from "react-native";

import { ConnectionGate } from "@/features/connect/ConnectionGate";

export default function IndexRoute() {
  return (
    <ConnectionGate>
      <View style={styles.screen}>
        <Text style={styles.title}>Dev10x Mobile</Text>
      </View>
    </ConnectionGate>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: "#111111",
    flex: 1,
    justifyContent: "center",
  },
  title: {
    color: "#e8e8e8",
    fontSize: 24,
    fontWeight: "700",
  },
});
