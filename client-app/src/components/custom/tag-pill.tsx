import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";
import { View } from "react-native";

export type Tag = {
  id: string;
  name: string;
  color: string; // hex, to be stored in DB probably
};

// Helper to lighten hex colors
function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function TagPill({ tag, height, count }: { tag: Tag; height: number; count?: number }) {
  const dotSize = 0.8 * height;
  const fontSize = 1 * height;
  const countFontSize = 0.9 * height;
  const countPaddingHorizontal = 0.9 * height;
  const countPaddingVertical = 0.1 * height;

  return (
    <Badge
      variant="outline"
      pointerEvents="none" 
      style={{
        backgroundColor: hexToRgba(tag.color, 0.15),
        borderColor: "transparent",
        paddingHorizontal: 0.9 * height,
        paddingVertical: 0.2 * height,
        gap: 0.5 * height,
      }}
    >
      {/* Colored dot */}
      <View
        style={{
          backgroundColor: tag.color,
          width: dotSize,
          height: dotSize,
          borderRadius: 999,
        }}
      />
      <Text style={{ color: tag.color, fontSize, fontWeight: "500", lineHeight: fontSize * 1.4}}>
        {tag.name}
      </Text>
      {/* Count of songs for that tag */ }
      {count !== undefined && (
        <View 
          style={{
            borderRadius: 999,  
            paddingHorizontal: countPaddingHorizontal,
            paddingVertical: countPaddingVertical,
            backgroundColor: hexToRgba(tag.color, 0.25),
          }}
        >
          <Text style={{ color: tag.color, fontSize: countFontSize, fontWeight: "500", lineHeight: fontSize * 1.4 }}>
            {count}
          </Text>
        </View>
      )}
    </Badge>
  );
}