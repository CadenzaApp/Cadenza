import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAccount } from '@/lib/account';
import { Tag } from '@/types/tag-types';

////////////////////////////////////////////////////////////////////////////////////
// Note: most of this file is boilerplate that react requires
// for sharing state among components without passing them down through props.
// Essentially this allows global data that represents the users tags to be exposed to 
// all props.
////////////////////////////////////////////////////////////////////////////////////

type TagsInfo = {
  tags: Tag[],                // All of the current user's tags
  loading: boolean,           // True if loading the user's tags
  error: string | null,       // Possible error while loading user's tags
  addTag: (tag: Tag) => void, // Callback for when tags are added 
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

        setTags(data.map((row) => ({ id: row.tag_id, name: row.name, color: row.color })));
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

  return (
    <TagsContext.Provider value={{ tags, loading, error, addTag }}>
      {children}
    </TagsContext.Provider>
  );
}

/**
 * Inserts a row into applied_tags, linking a tag to a song for the current user.
 */
export async function applyTagToSong(songId: string, tagId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('applied_tags')
    .insert({ user_id: userId, song_id: Number(songId), tag_id: Number(tagId) });

  if (error) throw error;
}

/**
 * Fetches all applied tags for a user across every song, returned as a
 * map of songId -> Tag[].
 */
export async function fetchAllSongTags(userId: string): Promise<Record<string, Tag[]>> {
  const { data, error } = await supabase
    .from('applied_tags')
    .select('song_id, tag_id, tags(name, color)')
    .eq('user_id', userId);

  if (error) throw error;

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
  return map;
}
