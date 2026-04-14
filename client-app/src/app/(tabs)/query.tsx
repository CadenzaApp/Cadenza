/*import { Text, View, StyleSheet } from "react-native";

export default function QueryScreen() {
    return (
        <View style={styles.container}>
            <Text style={styles.text}>Query Screen</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#25292e",
        justifyContent: "center",
        alignItems: "center",
    },
    text: {
        color: "#fff",
    },
}); */




/**
 * QueryBuilderDemo.tsx
 *
 * Drop this into any Expo screen to test the query builder.
 */
import React from "react";
import { SafeAreaView, StyleSheet } from "react-native";
import { QueryBuilder } from "../../features/query-builder/QueryBuilder";
import { Tag } from "../../types/tag-types";

const DEMO_TAGS: Tag[] = [
  { id: "1", name: "Pop123", color: "#FF6BA8" },
  { id: "2", name: "Japanese", color: "#7ECAFF" },
  { id: "3", name: "Funk", color: "#FFB347" },
  { id: "4", name: "Instrumental", color: "#A8FF78" },
  { id: "5", name: "Lo-fi", color: "#C9A0FF" },
  { id: "6", name: "80s", color: "#FF8C5A" },
];

export default function QueryBuilderDemo() {
  return (
    <SafeAreaView style={styles.safe}>
      <QueryBuilder
        tags={DEMO_TAGS}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0E0E12",
  },
});
