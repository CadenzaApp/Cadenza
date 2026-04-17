import { useAccount } from "@/lib/account";
import { supabase } from "@/lib/supabase";
import { Redirect } from "expo-router";
import { useState, useEffect } from "react";
import { Text } from "@/components/ui/text";
import { TagPill } from "@/components/custom/tag-pill";
import { CreateTagDialog } from "@/components/custom/create-tag-dialog";
import { Tag } from "@/types/tag-types"
import {
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

export default function TagsScreen() {
  const { account } = useAccount();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadingTags, setLoadingTags] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // send to login page
  if (!account) return <Redirect href="/auth?initialMode=signin" />;

  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      setFetchError(null);

      try {
        const { data, error } = await supabase
          .from('tags')
          .select('tag_id, name, color')
          .eq('user_id', account!.id)
          .order('name');

        if (error) throw error;

        setTags(data.map((row) => ({ id: row.tag_id, name: row.name, color: row.color })));
      } catch (err: unknown) {
        setFetchError(err instanceof Error ? err.message : 'Failed to load tags');
      } finally {
        setLoadingTags(false);
      }
    }

    fetchTags();
  }, [account?.id]);

  function handleTagCreated(newTag: Tag) {
    setTags((prev) => [...prev, newTag]);
  }

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text variant="h3" style={styles.pageTitle}>
            Your Tags
          </Text>
          <Text style={styles.subheading}>
            {tags.length} {tags.length === 1 ? "tag" : "tags"}
          </Text>
        </View>

        {fetchError && (
          <Text style={styles.errorText}>{fetchError}</Text>
        )}

        {loadingTags ? (
          <Text style={styles.subheading}>Loading...</Text>
        ) : (
          <View style={styles.tagsGrid}>
            {tags.map((tag) => (
              <TagPill key={tag.id} tag={tag} height={16} />
            ))}
          </View>
        )}
      </ScrollView>

      <CreateTagDialog onTagCreated={handleTagCreated} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#25292e",
    paddingHorizontal: 16,
    paddingTop: 60,
  },
  header: {
    marginBottom: 8,
  },
  pageTitle: {
    color: "#fff",
    marginBottom: 4,
    fontSize: 35,
    lineHeight: 50,
  },
  subheading: {
    color: "#888",
    fontSize: 20,
    marginBottom: 20,
  },
  errorText: {
    color: '#E05C5C',
    fontSize: 14,
    marginBottom: 12,
  },
  tagsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
});
