import React from "react";
import { SafeAreaView } from "react-native";
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
    <SafeAreaView style={{ flex: 1 }}>
      <QueryBuilder tags={DEMO_TAGS}/>
    </SafeAreaView>
  );
}