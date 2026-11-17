/**
 * What the command palette lists (docs: command palette, 11.2). Every source - entities, scenes,
 * pages, the settings index, the actions - turns its data into the same `PaletteItem`, so a source
 * added later (a package's own, Phase 3) needs nothing new in the interface.
 *
 * What a row does is data, not a closure: a `PaletteCommand` the palette carries out. A source is
 * then a pure function of what it was given, and a test can read what Enter would do.
 */
import type { ApiPackage, EntityView, IntegrationVendorView } from '@nebulahome/contracts';
import type { UiIconId } from '@nebulahome/ui';

/** The groups, in the order that breaks a tie between two groups' best rows. */
export const GROUP_ORDER = [
  'entities',
  'scenes',
  'automations',
  'devices',
  'pages',
  'settings',
  'integrations',
  'packages',
  'tags',
  'actions',
] as const;

/** A group of results: one per kind. */
export type PaletteGroupId = (typeof GROUP_ORDER)[number];

/** What a row does. */
export type PaletteCommand =
  | { readonly type: 'go'; readonly to: string }
  | { readonly type: 'apply-scene'; readonly sceneId: string; readonly name: string }
  | {
      readonly type: 'set-automation';
      readonly automationId: string;
      readonly name: string;
      readonly isEnabled: boolean;
    }
  | { readonly type: 'power'; readonly entity: EntityView }
  | { readonly type: 'sign-out' };

/** One of a row's two actions: what its key says, and what it does. */
export type PaletteAction = {
  /** The words beside the key: "Open", "Apply", "Turn on" (the last one decided live). */
  readonly hint: string;
  readonly command: PaletteCommand;
};

/** A row's glyph. */
export type PaletteIcon =
  | { readonly kind: 'ui'; readonly id: UiIconId }
  | {
      /** An icon of the catalogue the owner chose, or the kind's own while there is none. */
      readonly kind: 'catalogue';
      readonly iconId: string | null;
      readonly fallback: UiIconId;
    }
  | {
      readonly kind: 'vendor';
      readonly vendor: Pick<IntegrationVendorView, 'name' | 'logo' | 'color' | 'logoPadding'>;
    }
  | {
      readonly kind: 'package';
      readonly found: Pick<ApiPackage, 'id' | 'name' | 'color' | 'hasLogo'>;
    };

/** One result. */
export type PaletteItem = {
  /** Stable across opens: `<group>:<the thing's own id>`; what the recents keep. */
  readonly id: string;
  readonly group: PaletteGroupId;

  /** The thing's own id: an entity id, a scene's uuid, a page's path. */
  readonly refId: string;
  readonly title: string;

  /** The text after the title, quieter. */
  readonly secondary: string;

  /** What kind of thing it is, said before the second text where groups are mixed (Recent). */
  readonly kindLabel?: string;

  /** The title, folded (`foldForSearch`). */
  readonly foldedTitle: string;

  /** Everything else it is found by, folded: area, device, aliases, description. */
  readonly fields: readonly string[];

  /** Ids it is found by only whole - a pasted uuid or entity id - folded. Never a fragment. */
  readonly exactIds: readonly string[];
  readonly icon: PaletteIcon;

  /** A name the house gave, which a browser must not translate. */
  readonly isName: boolean;

  /** For an entity: its live state on the right and its chip's colour. */
  readonly entity?: EntityView;

  /** A state that is not live: an automation's On or Off. */
  readonly state?: { readonly text: string; readonly isQuiet: boolean };

  /** Something wrong with it, beside the state: an automation missing an entity. */
  readonly warning?: string;

  /** Loses a tie: an automation that is off. */
  readonly isDimmed?: boolean;

  /** A generated "Add device · X" row, offered only when the query starts with the verb. */
  readonly requiresVerb?: boolean;

  /** Enter. */
  readonly primary: PaletteAction;

  /** Tab, and the button on the active row; none for most kinds. */
  readonly secondaryAction?: PaletteAction;
};
