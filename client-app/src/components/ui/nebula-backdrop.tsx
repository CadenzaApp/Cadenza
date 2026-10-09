import { useColorScheme } from "nativewind";
import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import Animated, {
    cancelAnimation,
    Easing,
    runOnJS,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import { CROSSFADE_MS, Crossfade } from "@/components/ui/crossfade";
import { nebulaColor } from "@/lib/artwork-color-utils";
import { tradeColor, type ColorQueue } from "@/lib/color-queue";

type NebulaBackdropProps = {
    /** Up to five colors, the most important first. None fades it out. */
    colors: readonly string[];
};

/**
 * Where each blob sits and how big it is, as fractions of the screen. Fixed,
 * whatever the colors, so a new set recolors the blobs in place. Ellipses run
 * wider than the screen so no edge shows.
 */
type Slot = { x: number; y: number; w: number; h: number };
const SLOTS: readonly Slot[] = [
    { x: 0.15, y: 0.72, w: 1.3, h: 0.5 },
    { x: 0.85, y: 0.6, w: 1.2, h: 0.45 },
    { x: 0.3, y: 0.97, w: 1.4, h: 0.5 },
    { x: 0.8, y: 0.9, w: 1.3, h: 0.5 },
    { x: 0.45, y: 0.5, w: 1.1, h: 0.4 },
];

/**
 * Seconds per half cycle of each blob's size, brightness and drift. Different
 * and coprime, so the blobs never line up into a visible loop.
 */
const PERIODS = [
    { size: 11, glow: 7, drift: 17 },
    { size: 13, glow: 9, drift: 19 },
    { size: 15, glow: 8, drift: 23 },
    { size: 17, glow: 11, drift: 29 },
    { size: 19, glow: 10, drift: 31 },
];

/** Opacity of each blob's center, before it breathes. */
const PEAK = { dark: 0.65, light: 0.5 };

/** How long a blob takes to fade out to nothing, and back in a new color. */
const TRADE_FADE_MS = 3500;
/** How long a blob shows one color, picked at random in this range. */
const HOLD_MS = [10_000, 22_000] as const;
/** How long the first trades wait, spread out so they do not all go at once. */
const FIRST_HOLD_MS = [2_000, 14_000] as const;

/** One set of colors and which blob starts on which. */
type Palette = { key: string; colors: readonly string[]; byBlob: string[] };

/**
 * Soft blobs of color glowing up from the bottom of a page, in the style of
 * Apple Music's playlist backdrop. Fixed to the screen: mount it behind the
 * scroller, and the page slides over it.
 *
 * Always five blobs in fixed places. Fewer colors repeat around them. Each
 * blob slowly grows, shrinks, brightens, dims and drifts, on the UI thread.
 * Every so often one fades out to nothing, hands its color to the back of a
 * shared queue, and fades back in with the color at the front, so colors
 * wander around the screen.
 *
 * A new set of colors keeps every blob where it is, mid motion, and fades each
 * one to its new color over a second. No colors fades the whole nebula out.
 * Holds still and keeps its colors under reduced motion.
 */
export function NebulaBackdrop({ colors }: NebulaBackdropProps) {
    const { colorScheme = "light" } = useColorScheme();
    const palette = useMemo<Palette | null>(() => {
        if (colors.length === 0) return null;
        const shown = colors
            .slice(0, SLOTS.length)
            .map((color) => nebulaColor(color, colorScheme));
        return {
            key: shown.join(","),
            colors: shown,
            byBlob: SLOTS.map((_, index) => shown[index % shown.length]),
        };
    }, [colorScheme, colors]);

    // the last real palette, so fading out to no colors still has one to show
    const [kept, setKept] = useState(palette);
    if (palette && palette.key !== kept?.key) setKept(palette);

    const queue = useRef<ColorQueue>(kept?.colors ?? []);
    useEffect(() => {
        if (kept) queue.current = kept.colors;
    }, [kept]);
    const trade = useCallback((current: string) => {
        const next = tradeColor(queue.current, current);
        queue.current = next.queue;
        return next.color;
    }, []);

    const shown = useSharedValue(0);
    useEffect(() => {
        shown.set(withTiming(palette ? 1 : 0, { duration: CROSSFADE_MS }));
    }, [palette, shown]);
    const fade = useAnimatedStyle(() => ({ opacity: shown.get() }));

    return (
        <Animated.View
            pointerEvents="none"
            className="absolute inset-0 overflow-hidden"
            style={fade}
        >
            {kept
                ? SLOTS.map((slot, index) => (
                      <Blob
                          key={index}
                          paletteKey={kept.key}
                          startColor={kept.byBlob[index]}
                          trade={trade}
                          slot={slot}
                          period={PERIODS[index]}
                          peak={PEAK[colorScheme]}
                      />
                  ))
                : null}
        </Animated.View>
    );
}

function Blob({
    paletteKey,
    startColor,
    trade,
    slot,
    period,
    peak,
}: {
    paletteKey: string;
    startColor: string;
    trade: (current: string) => string;
    slot: Slot;
    period: (typeof PERIODS)[number];
    peak: number;
}) {
    const still = useReducedMotion();
    const size = useBreath(period.size, still);
    const glow = useBreath(period.glow, still);
    const drift = useBreath(period.drift, still);
    const { color, life } = useTradedColor(
        paletteKey,
        startColor,
        trade,
        still,
    );

    const breathe = useAnimatedStyle(() => ({
        opacity: life.get() * (0.6 + 0.4 * glow.get()),
        transform: [
            { translateX: (drift.get() - 0.5) * 48 },
            { translateY: (0.5 - drift.get()) * 24 },
            { scale: 0.88 + 0.24 * size.get() },
        ],
    }));

    return (
        <Animated.View
            className="absolute"
            style={[
                {
                    left: `${(slot.x - slot.w / 2) * 100}%`,
                    top: `${(slot.y - slot.h / 2) * 100}%`,
                    width: `${slot.w * 100}%`,
                    height: `${slot.h * 100}%`,
                },
                breathe,
            ]}
        >
            <Crossfade
                value={color}
                initial={color}
                keyOf={(shown) => shown}
                render={(shown) => <Glow color={shown} peak={peak} />}
            />
        </Animated.View>
    );
}

/** One blob's radial glow in one color, filling its parent. */
function Glow({ color, peak }: { color: string; peak: number }) {
    // svg ids go in url(#id), which the characters useId makes can break
    const id = `nebula${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

    return (
        <Svg width="100%" height="100%">
            <Defs>
                <RadialGradient id={id} cx="50%" cy="50%" r="50%">
                    {/* eased falloff, so the edge has no visible rim */}
                    <Stop offset="0" stopColor={color} stopOpacity={peak} />
                    <Stop
                        offset="0.3"
                        stopColor={color}
                        stopOpacity={peak * 0.75}
                    />
                    <Stop
                        offset="0.6"
                        stopColor={color}
                        stopOpacity={peak * 0.3}
                    />
                    <Stop
                        offset="0.85"
                        stopColor={color}
                        stopOpacity={peak * 0.07}
                    />
                    <Stop offset="1" stopColor={color} stopOpacity={0} />
                </RadialGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${id})`} />
        </Svg>
    );
}

/**
 * A blob's color and how much of it shows, 0 to 1. Holds a color for a while,
 * fades out, trades it for the next in the queue, and fades back in, forever.
 * Shows the first color fully from the start, and never trades when `still`.
 * A new palette jumps straight to `startColor` without touching the cycle,
 * and the caller fades the color across.
 */
function useTradedColor(
    paletteKey: string,
    startColor: string,
    trade: (current: string) => string,
    still: boolean,
) {
    const [color, setColor] = useState(startColor);
    const [colorFor, setColorFor] = useState(paletteKey);
    if (colorFor !== paletteKey) {
        setColorFor(paletteKey);
        setColor(startColor);
    }
    // counts trades, so one that hands back the same color still restarts
    const [turn, setTurn] = useState(0);
    const life = useSharedValue(1);

    const swap = useCallback(() => {
        setColor(trade(color));
        setTurn((count) => count + 1);
    }, [color, trade]);

    useEffect(() => {
        if (still) {
            life.set(1);
            return;
        }
        const fadeOut = withDelay(
            between(turn === 0 ? FIRST_HOLD_MS : HOLD_MS),
            withTiming(0, { duration: TRADE_FADE_MS }, (finished) => {
                if (finished) runOnJS(swap)();
            }),
        );
        life.set(
            turn === 0
                ? fadeOut
                : withSequence(
                      withTiming(1, { duration: TRADE_FADE_MS }),
                      fadeOut,
                  ),
        );
        return () => cancelAnimation(life);
    }, [life, still, swap, turn]);

    return { color, life };
}

function between([low, high]: readonly [number, number]) {
    return low + Math.random() * (high - low);
}

/**
 * 0 to 1 and back, eased, forever, one way taking `seconds`. Sits at the
 * middle when `still`.
 */
function useBreath(seconds: number, still: boolean): SharedValue<number> {
    const value = useSharedValue(0.5);

    useEffect(() => {
        if (still) {
            value.set(0.5);
            return;
        }
        // start at a random point, so two blobs on the same period differ
        value.set(Math.random());
        value.set(
            withRepeat(
                withTiming(1, {
                    duration: seconds * 1000,
                    easing: Easing.inOut(Easing.sin),
                }),
                -1,
                true,
            ),
        );
        return () => cancelAnimation(value);
    }, [seconds, still, value]);

    return value;
}
