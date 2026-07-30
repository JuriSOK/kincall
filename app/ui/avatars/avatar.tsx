import { isAvatarKey } from "@/lib/avatars";
import { AVATAR_REGISTRY } from "./registry";

export type AvatarSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-lg",
};

export interface AvatarProps {
  // The stored value — may be null (nobody selected one) or, in principle, a
  // historical/corrupted value that no longer matches a registered key. Both
  // fall back to initials, never to a broken-image icon or a thrown error.
  avatarKey: string | null;
  // Whose avatar this is — used only to build the accessible name
  // ("{name}'s avatar") and the initials fallback. Never displayed as text
  // next to the graphic; the caller decides whether to also show the name.
  name: string;
  size?: AvatarSize;
  className?: string;
}

// The one place avatarKey is turned into pixels, anywhere in the app —
// dashboard profile cards, history rows, the person page, the edit form's
// live preview. A single fallback path here is what guarantees a stale or
// unrecognised key can never break rendering.
export function Avatar({ avatarKey, name, size = "md", className }: AvatarProps) {
  const sizeClasses = SIZE_CLASSES[size];
  const label = `${name || "This profile"}'s avatar`;

  if (avatarKey && isAvatarKey(avatarKey)) {
    const Graphic = AVATAR_REGISTRY[avatarKey];
    return (
      <span
        role="img"
        aria-label={label}
        className={`inline-flex shrink-0 overflow-hidden rounded-full ${sizeClasses} ${className ?? ""}`}
      >
        <Graphic className="h-full w-full" />
      </span>
    );
  }

  const initial = name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-sunken font-semibold text-muted ${sizeClasses} ${className ?? ""}`}
    >
      {initial}
    </span>
  );
}
