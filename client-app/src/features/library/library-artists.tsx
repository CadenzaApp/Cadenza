import { View } from "react-native";

import { ArtistList } from "@/components/custom/artist-list";
import { ErrorNotice } from "@/components/custom/error-notice";
import {
    useLibraryArtistSearchPages,
    useLibraryArtists,
} from "@/lib/musickit-hooks";

import { LibraryListHeader, useLibraryListSearch } from "./library-list-header";

/** The Artists category: the library's artists, or the ones matching search. */
export function LibraryArtists() {
    const search = useLibraryListSearch();
    const searching = search.term !== null;
    const artists = useLibraryArtists();
    const results = useLibraryArtistSearchPages(search.term, searching);
    const list = searching
        ? results
        : {
              items: artists.artists,
              isLoading: artists.artistsLoading,
              isLoadingNextPage: artists.artistsLoadingNextPage,
              hasNextPage: artists.hasNextArtistsPage,
              loadNextPage: artists.loadNextArtistsPage,
              error: artists.artistsErr,
          };

    return (
        <>
            {list.error ? <ErrorNotice error={list.error} /> : null}
            <View className="flex-1">
                <ArtistList
                    artists={list.items}
                    isLoading={list.isLoading}
                    isLoadingNextPage={list.isLoadingNextPage}
                    hasNextPage={list.hasNextPage}
                    onLoadNextPage={() => void list.loadNextPage()}
                    emptyLabel={
                        searching
                            ? "No artists in your library match."
                            : "No artists in your library yet."
                    }
                    header={
                        <LibraryListHeader
                            search={search}
                            placeholder="Search Artists"
                        />
                    }
                />
            </View>
        </>
    );
}
