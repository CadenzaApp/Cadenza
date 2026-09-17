import { LibraryCategoryScreen } from "@/features/library/library-category-screen";

/** Compatibility root route; Library itself uses its nested tab-stack route. */
export default function RootLibraryCategoryScreen() {
    return <LibraryCategoryScreen presentation="detail" />;
}
