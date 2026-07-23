import { StyleSheet, Text, View } from "react-native";

export default function IndexRoute() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Dev10x Mobile</Text>
    </View>
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
