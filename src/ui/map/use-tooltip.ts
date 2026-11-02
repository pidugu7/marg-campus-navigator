/**
 * Which map item is being described, and where the description goes.
 *
 * Three input methods, one state: hover for a mouse, tap for a finger, focus for a keyboard. The rule that
 * makes them coexist is the pointer *type* — a mouse leaves things behind when you move away, so its tip
 * closes on `pointerleave`; a finger has already lifted by then and closing there would make the tooltip
 * impossible to read, so a tap's tip stays until you tap the map, tap another marker, or press Escape. That
 * asymmetry is the whole "phones have no hover" requirement, and it is the reason `hide` takes an id:
 * crossing two markers with a mouse must not let the older one's `leave` close the newer one's tip.
 */
import { useCallback, useMemo, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { tipSide } from "./view";
import type { TipContent } from "./tip-content";

export interface TipAnchor {
  readonly x: number;
  readonly y: number;
}

export interface TipState extends TipAnchor {
  readonly id: string;
  readonly content: TipContent;
  readonly side: "above" | "below";
}

export interface Tooltip {
  readonly tip: TipState | null;
  /** `screen` is already in plate pixels — the caller projects, because only the caller knows the camera. */
  readonly show: (id: string, screen: TipAnchor, content: TipContent) => void;
  readonly hide: (id?: string) => void;
  readonly onEscape: (event: ReactKeyboardEvent) => void;
}

/** Height the tip needs on its chosen side: its own box, plus the gap it floats clear by. */
const ROOM_PER_LINE = 15;
const ROOM_CHROME = 26;

export function useTooltip(plateHeight: number): Tooltip {
  const [tip, setTip] = useState<TipState | null>(null);

  const show = useCallback(
    (id: string, screen: TipAnchor, content: TipContent) => {
      const room = ROOM_CHROME + content.lines.length * ROOM_PER_LINE;
      setTip({
        id,
        x: screen.x,
        y: screen.y,
        content,
        side: tipSide(screen.y, plateHeight, room),
      });
    },
    [plateHeight],
  );

  const hide = useCallback((id?: string) => {
    setTip((current) =>
      current === null
        ? null
        : id === undefined || current.id === id
          ? null
          : current,
    );
  }, []);

  // Escape closes the tip but keeps focus where it was, so a keyboard user can Tab on. Other keys are
  // left alone: the map's own shortcuts live on the plate and must not be swallowed here.
  const onEscape = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        hide();
      }
    },
    [hide],
  );

  return useMemo(
    () => ({ tip, show, hide, onEscape }),
    [tip, show, hide, onEscape],
  );
}

/**
 * The three handlers every describable map item needs. Mouse/touch is one pair, keyboard is focus — and
 * `aria-describedby` on the element ties the text to the control for a screen reader, which is the point of
 * making these focusable in the first place.
 */
export function tipHandlers(input: {
  readonly id: string;
  readonly screen: () => TipAnchor;
  readonly content: () => TipContent;
  readonly show: Tooltip["show"];
  readonly hide: Tooltip["hide"];
}): {
  onPointerEnter: (event: ReactPointerEvent) => void;
  onPointerLeave: (event: ReactPointerEvent) => void;
  onPointerDown: () => void;
  onFocus: () => void;
  onBlur: () => void;
} {
  const { id, screen, content, show, hide } = input;
  return {
    onPointerEnter: () => show(id, screen(), content()),
    onPointerLeave: (event) => {
      if (event.pointerType === "mouse") hide(id);
    },
    // A tap is also the start of a drag, and a tip that survives the drag is describing something the
    // person has since moved away from. `map-view` hides on the plate's own pointerdown, which runs first
    // for the background and is stopped here for the item.
    onPointerDown: (event?: unknown) => {
      (event as { stopPropagation?: () => void })?.stopPropagation?.();
      show(id, screen(), content());
    },
    onFocus: () => show(id, screen(), content()),
    onBlur: () => hide(id),
  };
}
