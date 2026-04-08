import { useAccount } from "@/lib/account";
import { Redirect } from "expo-router";
import { useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "@/components/ui/text";
 
type Tag = {
  id: string;
  name: string;
  color: string; // hex, to be stored in DB probably
};
 
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
 
 
// Helper to lighten hex colors 
function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Helper to return songs that belong to a Tag
function getSongsForTag(tagId: string) {
  return MOCK_SONGS.filter((s) => s.tags.some((t) => t.id === tagId));
}
 

function TagPill({ tag, size = 10 }: { tag: Tag; size?: number }) {

  const paddingHorizontal = 14 * size / 10;
  const paddingVertical = 7 * size / 10;
  const dotSize = 8 * size / 10;      
  const fontSize = 14 * size / 10;    

  return (
    <View
      style={[
        styles.tagPill,
        {
          backgroundColor: hexToRgba(tag.color, 0.15),
          paddingHorizontal,
          paddingVertical,
        },
      ]}
    >
      <View
        style={[
          styles.tagDot,
          {
            backgroundColor: tag.color,
            width: dotSize,
            height: dotSize,
          },
        ]}
      />
      <Text
        style={[
          styles.tagPillText,
          {
            color: tag.color,
            fontSize,
          },
        ]}
      >
        {tag.name}
      </Text>
    </View>
  );
}


 
function SongRow({ song }: { song: Song }) {
  return (
    <View style={styles.songCard}>
      <Text style={styles.songTitle}>{song.title}</Text>
      <Text style={styles.songArtist}>{song.artist}</Text>
      <View style={styles.songTagRow}>
        {song.tags.map((tag) => (
          <TagPill key={tag.id} tag={tag} size={8} />
        ))}
      </View>
    </View>
  );
}


function TagButton({ tag, count, onPress, size = 10 }: {tag: Tag, count: number, onPress: () => void, size?: number }) {

  const paddingVertical = size;
  const paddingHorizontal = 1.6 * size;
  const dotSize = 0.8 * size;
  const fontSize = 1.5 * size;
  const countFontSize = 1.2 * size;
  const countPaddingHorizontal = 0.8 * size;
  const countPaddingVertical = 0.2 * size;
  const gap = 0.8 * size;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderRadius: 999,
          paddingVertical,
          paddingHorizontal,
          gap,
          backgroundColor: hexToRgba(tag.color, 0.12),
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap }}>
        <View
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: 999,
            backgroundColor: tag.color,
          }}
        />
        <Text style={{ color: tag.color, fontSize, fontWeight: "500" }}>
          {tag.name}
        </Text>
      </View>

      {count !== undefined && (
        <View
          style={{
            borderRadius: 999,
            paddingHorizontal: countPaddingHorizontal,
            paddingVertical: countPaddingVertical,
            backgroundColor: hexToRgba(tag.color, 0.25),
          }}
        >
          <Text
            style={{
              color: tag.color,
              fontSize: countFontSize,
              fontWeight: "500",
            }}
          >
            {count}
          </Text>
        </View>
      )}
    </Pressable>
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
            <TagPill tag={selectedTag} size={20} />
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
                <TagButton
                    key={tag.id}
                    tag={tag}
                    count={count}
                    size={14} 
                    onPress={() => setSelectedTag(tag)}
                />
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
  tagButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 8,
    flexBasis: '100%'
  },
  tagButtonPressed: {
    opacity: 0.7,
  },
  tagButtonInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tagButtonText: {
    fontSize: 15,
    fontWeight: "500",
  },
  tagCount: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tagCountText: {
    fontSize: 12,
    fontWeight: "500",
  },
  tagPill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    gap: 5,
  },
  tagPillText: {
    fontWeight: "500",
  },
  tagDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
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
  songCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  songTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
  },
  songArtist: {
    color: "#888",
    fontSize: 13,
    marginBottom: 8,
  },
  songTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
});

