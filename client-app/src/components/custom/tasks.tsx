import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "nativewind";
import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";

import { TOP_RAIL_HEIGHT } from "@/components/custom/top-rail";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { NAV_THEME, THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** How a task turned out. The row draws one icon per value. */
export type TaskStatus = "success" | "fail";

/** How long an ended task keeps its icon on screen before its row goes. */
const LINGER_MS = 1000;

/** Gap between the top rail and the first row. */
const RAIL_GAP = 8;

/** Big enough to keep the pill round at any row height. */
const ROW_RADIUS = 9999;

/** Both the spinner's box and the icon's, so the row does not jump on either. */
const ICON_BOX = 20;
const ICON_SIZE = 16;

type Task = {
    id: number;
    /** What the row reads. A failure replaces it with its message. */
    label: string;
    /** Unset while the task runs. Set once it ends, until its row is dropped. */
    status?: TaskStatus;
};

type TasksValue = {
    /** Puts a task on the overlay and hands back its id. */
    addTask: (label: string) => number;
    /**
     * Swaps the task's spinner for a check, then takes the row off a second
     * later. Ending the same task again does nothing.
     */
    endTaskSuccess: (id: number) => void;
    /**
     * The same with a cross, and `message` in place of the task's label. The
     * row draws both in red, so a failure reads as one even at a glance.
     */
    endTaskFail: (id: number, message: string) => void;
};

const TasksContext = createContext<TasksValue | null>(null);

/**
 * The rows themselves, separate from the actions so that adding a task does
 * not change the identity of `addTask` and `endTask`.
 */
const TaskListContext = createContext<Task[]>([]);

/**
 * Adds and ends the tasks the overlay draws. Both functions keep the same
 * identity for the life of the provider, so an effect can list them in its
 * dependencies.
 */
export function useTasks() {
    const value = useContext(TasksContext);
    if (!value) {
        throw new Error(
            "useTasks must be used under TasksProvider",
        );
    }
    return value;
}

/**
 * Owns the running tasks. Mounted at the root, above anything that starts
 * one. It draws nothing: `TasksHost` does, from further down the tree.
 */
export function TasksProvider({ children }: { children: ReactNode }) {
    const [tasks, setTasks] = useState<Task[]>([]);
    const nextId = useRef(0);
    const lingerTimerIds = useRef(
        new Map<number, ReturnType<typeof setTimeout>>(),
    );

    const value = useMemo<TasksValue>(() => {
        // both endings are this, with and without a message to show
        const endTask = (id: number, status: TaskStatus, message?: string) => {
            // already ending, so leave its icon and its timer alone
            if (lingerTimerIds.current.has(id)) return;

            setTasks((current) =>
                current.map((task) =>
                    task.id === id
                        ? { ...task, status, label: message ?? task.label }
                        : task,
                ),
            );

            lingerTimerIds.current.set(
                id,
                setTimeout(() => {
                    lingerTimerIds.current.delete(id);
                    setTasks((current) =>
                        current.filter((task) => task.id !== id),
                    );
                }, LINGER_MS),
            );
        };

        return {
            addTask: (label) => {
                const id = nextId.current++;
                setTasks((current) => [...current, { id, label }]);
                return id;
            },
            endTaskSuccess: (id) => endTask(id, "success"),
            endTaskFail: (id, message) => endTask(id, "fail", message),
        };
    }, []);

    return (
        <TasksContext.Provider value={value}>
            <TaskListContext.Provider value={tasks}>
                {children}
            </TaskListContext.Provider>
        </TasksContext.Provider>
    );
}

/**
 * The floating stack itself. Draws nothing while there is no task.
 *
 * Mounted beside `GlassBlurTarget` rather than inside `TasksProvider`,
 * because a row's glass only blurs on Android when it can read the blur
 * target, and the provider sits above `GlassBlurTargetProvider`.
 */
export function TasksHost() {
    const tasks = useContext(TaskListContext);
    const insets = useSafeAreaInsets();

    if (tasks.length === 0) return null;

    const rows = (
        // a status readout, so it never takes a tap from what is under it
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View
                className="absolute right-4 items-end gap-2"
                style={{ top: insets.top + TOP_RAIL_HEIGHT + RAIL_GAP }}
            >
                {tasks.map((task) => (
                    <TaskRow key={task.id} task={task} />
                ))}
            </View>
        </View>
    );

    // iOS draws a native presentation above ordinary React siblings, so the
    // rows go to the window layer. Same reason `BottomBarsOverlay` does it.
    if (Platform.OS !== "ios") return rows;

    return (
        <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>
            {rows}
        </FullWindowOverlay>
    );
}

/** One task: its label, behind a spinner while it runs and its result after. */
function TaskRow({ task }: { task: Task }) {
    const { colorScheme } = useColorScheme();
    const scheme = colorScheme === "dark" ? "dark" : "light";
    const { status } = task;

    return (
        <View
            accessible
            accessibilityLabel={
                status === undefined
                    ? task.label
                    : `${task.label}, ${status === "success" ? "done" : "failed"}`
            }
            className="max-w-[240px] flex-row items-center gap-2 rounded-full border border-border px-3 py-1.5 shadow-sm"
        >
            {/* A background layer rather than a background color, so the row
                is translucent. It clips itself, which is why it cannot be the
                same view as the shadow above. */}
            <GlassSurface
                style={[
                    StyleSheet.absoluteFill,
                    { borderRadius: ROW_RADIUS, overflow: "hidden" },
                ]}
            />
            <View
                className="items-center justify-center"
                style={{ width: ICON_BOX, height: ICON_BOX }}
            >
                {status === undefined ? (
                    <ActivityIndicator
                        size="small"
                        color={NAV_THEME[scheme].colors.text}
                    />
                ) : (
                    <Ionicons
                        name={
                            status === "success"
                                ? "checkmark-circle"
                                : "close-circle"
                        }
                        size={ICON_SIZE}
                        color={
                            status === "success"
                                ? THEME[scheme].success
                                : THEME[scheme].destructive
                        }
                    />
                )}
            </View>
            <Text
                className={cn(
                    "shrink text-xs font-medium",
                    status === "fail" && "text-destructive",
                )}
                numberOfLines={1}
            >
                {task.label}
            </Text>
        </View>
    );
}
