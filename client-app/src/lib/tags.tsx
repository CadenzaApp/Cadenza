import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAccount } from '@/lib/account';
import { Tag } from '@/types/tag-types';

////////////////////////////////////////////////////////////////////////////////////
// Note: most of this file is boilerplate that react requires
// for sharing state among components without passing them down through props.
// Essentially this allows global data that represents the users tags to be exposed to
// all components.
////////////////////////////////////////////////////////////////////////////////////

type TagsInfo = {
  // The current user's created tags
  tags: Tag[];
  loading: boolean;
  error: string | null;
  addTag: (tag: Tag) => void;

  // Map of songId -> tags applied to that song
  songTagsMap: Record<string, Tag[]>;
  loadSongTags: () => Promise<Record<string, Tag[]>>;
  applyTag: (songId: string, tag: Tag) => Promise<void>;
  removeTag: (songId: string, tag: Tag) => Promise<void>;
};

const TagsContext = createContext<TagsInfo | null>(null);

export function useTags() {
  return useContext(TagsContext)!;
}

export function TagsProvider({ children }: { children: ReactNode }) {
  const { account } = useAccount();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [songTagsMap, setSongTagsMap] = useState<Record<string, Tag[]>>({});

  // Load the user's created tags whenever the account changes
  useEffect(() => {
    if (!account) return;

    async function fetchTags() {
      setLoading(true);
      setError(null);

      try {
        const { data, error: dbError } = await supabase
          .from('tags')
          .select('tag_id, name, color')
          .eq('user_id', account!.id)
          .order('name');

        if (dbError) throw dbError;

        setTags(data.map((row) => ({ id: String(row.tag_id), name: row.name, color: row.color })));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load tags.');
      } finally {
        setLoading(false);
      }
    }

    fetchTags();
  }, [account?.id]);

  function addTag(tag: Tag) {
    setTags((prev) => [...prev, tag]);
  }

  /**
   * Fetches all applied tags for the user across every song and populates
   * songTagsMap. Call this after loading the song library.
   */
  async function loadSongTags(): Promise<Record<string, Tag[]>> {
    if (!account) return {};

    const { data, error: dbError } = await supabase
      .from('applied_tags')
      .select('song_id, tag_id, tags(name, color)')
      .eq('user_id', account.id);

    if (dbError) throw dbError;

    const map: Record<string, Tag[]> = {};
    for (const row of (data ?? []) as any[]) {
      const songId = String(row.song_id);
      if (!map[songId]) map[songId] = [];
      map[songId].push({
        id: String(row.tag_id),
        name: row.tags.name,
        color: row.tags.color,
      });
    }
    setSongTagsMap(map);
    return map;
  }

  /**
   * Applies a tag to a song
   */
  async function applyTag(songId: string, tag: Tag) {
    if (!account) return;

    setSongTagsMap((prev) => ({
      ...prev,
      [songId]: [...(prev[songId] ?? []), tag],
    }));

    const { error: dbError } = await supabase
      .from('applied_tags')
      .insert({ user_id: account.id, song_id: Number(songId), tag_id: Number(tag.id) });

    if(dbError) {
      // Roll back
      setSongTagsMap((prev) => ({
        ...prev,
        [songId]: (prev[songId] ?? []).filter((t) => t.id !== tag.id),
      }));
      Alert.alert('Error', 'Failed to add tag. Please try again.');
      console.error('Failed to apply tag:', dbError);
    }
  }

  /**
   * Removes a tag from a song
   */
  async function removeTag(songId: string, tag: Tag) {
    if(!account) return;

    setSongTagsMap((prev) => ({
      ...prev,
      [songId]: (prev[songId] ?? []).filter((t) => t.id !== tag.id),
    }));

    const { error: dbError } = await supabase
      .from('applied_tags')
      .delete()
      .eq('user_id', account.id)
      .eq('song_id', Number(songId))
      .eq('tag_id', Number(tag.id));

    if(dbError) {
      // Roll back
      setSongTagsMap((prev) => ({
        ...prev,
        [songId]: [...(prev[songId] ?? []), tag],
      }));
      Alert.alert('Error', 'Failed to remove tag. Please try again.');
      console.error('Failed to remove tag:', dbError);
    }
  }

  return (
    <TagsContext.Provider value={{ tags, loading, error, addTag, songTagsMap, loadSongTags, applyTag, removeTag }}>
      {children}
    </TagsContext.Provider>
  );
}
