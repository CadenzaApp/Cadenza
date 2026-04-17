import { useAccount } from "@/lib/account";
import { useTags } from "@/lib/tags";
import { Redirect } from "expo-router";
import { Text } from "@/components/ui/text";
import { TagPill } from "@/components/custom/tag-pill";
import { CreateTagDialog } from "@/components/custom/create-tag-dialog";
import { Tag } from "@/types/tag-types";
import {
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

export default function TagsScreen() {
  const { account } = useAccount();
  const { tags, loading: loadingTags, error: fetchError, addTag } = useTags(); // get global tags context

  if (!account) return <Redirect href="/auth?initialMode=signin" />;

  function handleTagCreated(newTag: Tag) {
    addTag(newTag);
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
              <TagPill key={tag.id} tag={tag} height={20} />
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
