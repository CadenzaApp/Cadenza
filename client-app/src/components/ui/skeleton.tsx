import { cn } from "@/lib/utils";
import { createContext, useContext } from "react";
import { View } from "react-native";

export const SkeletonAnimationContext = createContext(true);

function Skeleton({ className, ...props }: React.ComponentProps<typeof View>) {
    const animated = useContext(SkeletonAnimationContext);
    return (
        <View
            className={cn(
                "bg-accent rounded-md",
                // Establish the animated host on mount, including while paused.
                animated ? "animate-pulse" : "animate-none",
                className,
            )}
            {...props}
        />
    );
}

export { Skeleton };
