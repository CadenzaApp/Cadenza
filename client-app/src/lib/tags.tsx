import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAccount } from '@/lib/account';
import { Tag } from '@/lib/types';

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
