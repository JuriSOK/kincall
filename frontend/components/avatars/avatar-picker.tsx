import { AVATAR_KEYS } from "@/shared/utilities/avatars";
import { AVATAR_REGISTRY } from "./registry";

export interface AvatarPickerProps {
  /** The form field name each radio submits under, e.g. "avatarKey". */
  name?: string;
  defaultValue?: string | null;
  legend?: string;
}

// A native radio group, not a custom ARIA widget: every option is a real
// `<input type="radio">`, visually replaced by the avatar graphic. This is
// deliberate, not a shortcut —
//
//   - keyboard operation (arrow keys move between options, Space selects)
//     and "selected" announcement to assistive technology both come for free
//     from the browser's own radio semantics, with no tabindex management or
//     aria-checked bookkeeping to get right by hand;
//   - it needs no client JavaScript, so this can be a plain Server Component
//     and still work inside the (client) create/edit forms via ordinary
//     FormData submission;
//   - each option's `sr-only` text is its accessible name — the graphic
//     itself is aria-hidden (registry.tsx), since an abstract shape has
//     nothing inherent to describe.
//
// The visible "selected" indicator (a ring) is driven by the CSS
// `:checked`/`peer-checked` state, so it can never desync from what a
// keyboard or screen-reader user actually has selected.
export function AvatarPicker({ name = "avatarKey", defaultValue, legend = "Avatar" }: AvatarPickerProps) {
  const ringClasses =
    "ring-2 ring-offset-2 ring-offset-surface transition-shadow " +
    "ring-transparent peer-checked:ring-accent " +
    "peer-focus-visible:outline peer-focus-visible:outline-2 " +
    "peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent";

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {AVATAR_KEYS.map((key) => {
          const Graphic = AVATAR_REGISTRY[key];
          return (
            <label key={key} className="cursor-pointer">
              <input
                type="radio"
                name={name}
                value={key}
                defaultChecked={defaultValue === key}
                className="peer sr-only"
              />
              <span className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full ${ringClasses}`}>
                <Graphic className="h-full w-full" />
              </span>
              <span className="sr-only">{key}</span>
            </label>
          );
        })}

        {/* The explicit "use initials instead" option — an empty value,
            validated by avatarKeyField (shared/validation/profile.ts) exactly
            like an entirely absent field. */}
        <label className="cursor-pointer">
          <input
            type="radio"
            name={name}
            value=""
            defaultChecked={!defaultValue}
            className="peer sr-only"
          />
          <span
            className={`flex h-12 w-12 items-center justify-center rounded-full bg-sunken text-xs font-semibold text-muted ${ringClasses}`}
          >
            Aa
          </span>
          <span className="sr-only">No avatar — use initials</span>
        </label>
      </div>
    </fieldset>
  );
}
