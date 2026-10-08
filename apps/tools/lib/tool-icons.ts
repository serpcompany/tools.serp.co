import {
  FileImage,
  FileJson,
  Image,
  Mic,
  Music,
  Table,
  Type,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ToolIconName } from "@/lib/catalog/icons";

// The component for each icon name the catalog assigns (lib/catalog/icons.ts).
export const TOOL_ICONS: Record<ToolIconName, LucideIcon> = {
  image: Image,
  "file-image": FileImage,
  "file-json": FileJson,
  mic: Mic,
  music: Music,
  table: Table,
  type: Type,
  video: Video,
};
