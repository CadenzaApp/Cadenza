import { useAccount } from "@/lib/account";
import { Redirect } from "expo-router";
import { useState } from "react";
import { Text } from "@/components/ui/text";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TagPill, type Tag } from "@/components/custom/tag-pill";
import {
  FlatList,
  Pressable,
  ScrollView,  
  StyleSheet,
  View,
} from "react-native";



type Song = {
  id: string;
  title: string;
  artist: string;
  tags: Tag[];
};


// MOCK DATA, change all this once we have DB set up with schema 
const MOCK_TAGS: Tag[] = [
  { id: "1", name: "Chill", color: "#1D9E75" },
  { id: "2", name: "Rap", color: "#D85A30" },
  { id: "3", name: "Funk", color: "#7F77DD" },
  { id: "4", name: "Focus", color: "#378ADD" },
  { id: "5", name: "Vocaloid", color: "#D4537E" },
  { id: "6", name: "Workout", color: "#BA7517" },
  { id: "7", name: "Japanese", color: "#e02baa" },
];

const MOCK_SONGS: Song[] = [
  {
    id: "s1",
    title: "Song",
    artist: "Kanye",
    tags: [MOCK_TAGS[0], MOCK_TAGS[2]],
  },
  {
    id: "s2",
    title: "Test",
    artist: "Kairiki Bear",
    tags: [MOCK_TAGS[0], MOCK_TAGS[4], MOCK_TAGS[6]],
  },
  {
    id: "s3",
    title: "Gymnopedie",
    artist: "Erik Satie",
    tags: [MOCK_TAGS[0], MOCK_TAGS[3]],
  },
  {
    id: "s4",
    title: "Motion Picture Soundtrack",
    artist: "Radiohead",
    tags: [MOCK_TAGS[0]],
  },
  {
    id: "s5",
    title: "HUMBLE.",
    artist: "Kendrick Lamar",
    tags: [MOCK_TAGS[1], MOCK_TAGS[5]],
  },
  {
    id: "s6",
    title: "Power",
    artist: "Kanye West",
    tags: [MOCK_TAGS[1]],
  },
  {
    id: "s7",
    title: "Run The World",
    artist: "Beyonce",
    tags: [MOCK_TAGS[1], MOCK_TAGS[5]],
  },
  {
    id: "s8",
    title: "Midnight City",
    artist: "M83",
    tags: [MOCK_TAGS[2]],
  },
  {
    id: "s9",
    title: "Experience",
    artist: "Ludovico Einaudi",
    tags: [MOCK_TAGS[3]],
  },
  {
    id: "s10",
    title: "Hitogawari",
    artist: "Kikuo",
    tags: [MOCK_TAGS[4], MOCK_TAGS[6]],
  },
];


// Helper to return songs that belong to a Tag
function getSongsForTag(tagId: string) {
  return MOCK_SONGS.filter((s) => s.tags.some((t) => t.id === tagId));
}


function SongRow({ song }: { song: Song }) {
  return (
    <Card style={{ backgroundColor: "rgba(255,255,255,0.06)", borderColor: "transparent" }}>
      <CardHeader style={{ gap: 2, paddingBottom: 8 }}>
        <CardTitle style={{ color: "#fff", fontSize: 15 }}>
          {song.title}
        </CardTitle>
        <CardDescription style={{ color: "#888", fontSize: 13 }}>
          {song.artist}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {song.tags.map((tag) => (
            <TagPill key={tag.id} tag={tag} height={13} />
          ))}
        </View>
      </CardContent>
    </Card>
  );
}


export default function TagsScreen() {
  const { account } = useAccount();
  const [selectedTag, setSelectedTag] = useState<Tag | null>(null);

  if (!account) return <Redirect href="/auth?initialMode=signin" />;

  const songsForTag = selectedTag ? getSongsForTag(selectedTag.id) : [];

  return (
    <View style={styles.container}>
      {selectedTag ? (
        // Show songs for tag
        <>
          <View style={styles.header}>
            <Pressable onPress={() => setSelectedTag(null)} style={styles.backButton}>
              <Text style={styles.backButtonText}>← Back</Text>
            </Pressable>
            <TagPill tag={selectedTag} height={20} count={3}/>
          </View>

          <Text style={styles.subheading}>
            {songsForTag.length} {songsForTag.length === 1 ? "song" : "songs"}
          </Text>

          <FlatList
            data={songsForTag}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <SongRow song={item} />}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        </>
      ) : (
        // Show all user's tags
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text variant="h3" style={styles.pageTitle}>
              Your Tags
            </Text>
            <Text style={styles.subheading}>
              {MOCK_TAGS.length} tags - {MOCK_SONGS.length} songs
            </Text>
          </View>

          <View style={styles.tagsGrid}>
            {MOCK_TAGS.map((tag) => {
              const count = getSongsForTag(tag.id).length;
              return (
                <Pressable
                  key={tag.id}
                  onPress={() => setSelectedTag(tag)}
                  style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                >
                  <TagPill tag={tag} height={16} count={count} />
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
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
  },
  subheading: {
    color: "#888",
    fontSize: 20,
    marginBottom: 20,
  },
  tagsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  backButton: {
    alignSelf: "flex-start",
    marginBottom: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  backButtonText: {
    color: "#fff",
    fontSize: 14,
  },
  listContent: {
    gap: 10,
    paddingBottom: 40,
  },
});