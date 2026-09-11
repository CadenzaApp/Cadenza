import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { ScrollView, View } from "react-native";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardTitle,
} from "@/components/ui/card";
import { Text } from "@/components/ui/text";

type IoniconName = keyof typeof Ionicons.glyphMap;

export type FeaturePreview = {
    icon: IoniconName;
    title: string;
    description: string;
};

type Props = {
    icon: IoniconName;
    headline: string;
    description: string;
    actionLabel: string;
    features: FeaturePreview[];
};

export function ComingSoonScreen({
    icon,
    headline,
    description,
    actionLabel,
    features,
}: Props) {
    const { colors } = useTheme();

    return (
        <ScrollView
            className="flex-1 bg-background"
            contentContainerClassName="gap-4 px-5 pt-5 pb-32"
            showsVerticalScrollIndicator={false}
        >
            <Card className="gap-0 overflow-hidden border-0 bg-foreground py-0">
                <CardContent className="gap-5 px-6 py-7">
                    <View className="flex-row items-center justify-between">
                        <View className="h-12 w-12 items-center justify-center rounded-full bg-background/10">
                            <Ionicons
                                name={icon}
                                size={26}
                                color={colors.background}
                            />
                        </View>
                        <Badge variant="secondary" className="px-3 py-1">
                            <Text>Coming soon</Text>
                        </Badge>
                    </View>

                    <View className="gap-2">
                        <Text className="text-3xl font-bold tracking-tight text-background">
                            {headline}
                        </Text>
                        <Text className="text-base leading-6 text-background/70">
                            {description}
                        </Text>
                    </View>

                    <Button
                        disabled
                        variant="secondary"
                        className="self-start opacity-60"
                    >
                        <Text>{actionLabel}</Text>
                    </Button>
                </CardContent>
            </Card>

            <View className="gap-3">
                {features.map((feature) => (
                    <Card key={feature.title} className="gap-0 py-0">
                        <CardContent className="flex-row items-center gap-4 px-5 py-5">
                            <View className="h-11 w-11 items-center justify-center rounded-full bg-muted">
                                <Ionicons
                                    name={feature.icon}
                                    size={22}
                                    color={colors.primary}
                                />
                            </View>
                            <View className="flex-1 gap-1">
                                <CardTitle className="text-base">
                                    {feature.title}
                                </CardTitle>
                                <CardDescription className="leading-5">
                                    {feature.description}
                                </CardDescription>
                            </View>
                        </CardContent>
                    </Card>
                ))}
            </View>
        </ScrollView>
    );
}
