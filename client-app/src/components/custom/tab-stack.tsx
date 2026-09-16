import { Stack } from "expo-router";

import { TopRail } from "@/components/custom/top-rail";

type Props = {
    title: string;
};

/** A native stack for one tab, with Cadenza's shared top rail as its header. */
export function TabStack({ title }: Props) {
    return (
        <Stack
            screenOptions={{
                header: ({ options }) => (
                    <TopRail
                        title={
                            typeof options.title === "string"
                                ? options.title
                                : title
                        }
                        actions={options.headerRight?.({ canGoBack: false })}
                    />
                ),
            }}
        >
            <Stack.Screen name="index" options={{ title }} />
        </Stack>
    );
}
