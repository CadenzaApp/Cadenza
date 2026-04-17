import React from "react";
import { SafeAreaView, ActivityIndicator, StyleSheet } from "react-native";
import { QueryBuilder } from "../../features/query-builder/QueryBuilder";
import { useAccount } from "@/lib/account";
import { useTags } from "@/lib/tags";
import { Text } from "@/components/ui/text";
import { Redirect } from "expo-router";

export default function QueryBuilderDemo() {
  const { account } = useAccount();
  const { tags, loading, error } = useTags();

  if (!account) return <Redirect href="/auth?initialMode=signin" />;

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color="#ff0000" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <QueryBuilder tags={tags} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#25292e',
  },
  centered: {
    flex: 1,
    backgroundColor: '#25292e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#E05C5C',
    fontSize: 14,
  },
});
