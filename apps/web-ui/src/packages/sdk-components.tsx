/**
 * The interface's implementation of `@nebulahome/package-sdk/components` (PACKAGES_DOCS.md 7.1):
 * the design system's own components, lent to a package as they are, and the catalogue's icons.
 *
 * {@link COMPONENTS_HOST} is checked against the SDK's `ComponentsHost`: each facade's props must
 * be accepted by the component lent for it, so the SDK cannot promise a prop the interface would
 * ignore.
 */
import type { EntityView } from '@nebulahome/contracts';
import type {
  ComponentsHost,
  EntityFieldProps,
  EntityPickerProps,
  IconProps,
  NameIconFieldProps,
} from '@nebulahome/package-sdk/components';
import type { EntityView as PackageEntityView } from '@nebulahome/package-sdk/ui';
import {
  Badge,
  Button,
  Calendar,
  CardHeading,
  CatalogueIcon,
  Checkbox,
  cn,
  DateField,
  Figure,
  Hint,
  IconButton,
  Modal,
  Panel,
  PanelNote,
  PanelRow,
  ProgressBar,
  RadioGroup,
  Segmented,
  SelectField,
  Slider,
  StatusDot,
  Stepper,
  Switch,
  TagChip,
  TextField,
  Tooltip,
} from '@nebulahome/ui';

import { viewOf } from '@/packages/sdk-ui';
import { useCatalogueIcons } from '@/routes/library/device-icon';
import { EntityField as HouseEntityField } from '@/routes/library/entity-field';
import { EntityPicker as HouseEntityPicker } from '@/routes/library/entity-picker/entity-picker';
import { IconField } from '@/routes/library/icon-field';
import { NameIconField as HouseNameIconField } from '@/routes/library/name-icon-field';

/**
 * What a package's `domains` and `accept` let be chosen.
 *
 * @param domains - The domains, or undefined for any.
 * @param accept - The package's own test, since SDK 1.11, or undefined for none.
 * @returns The interface's `accept`, or undefined for every entity.
 */
function acceptOf(
  domains: readonly string[] | undefined,
  accept: ((entity: PackageEntityView) => boolean) | undefined,
): ((entity: EntityView) => boolean) | undefined {
  return domains === undefined && accept === undefined
    ? undefined
    : (entity) =>
        (domains?.includes(entity.domain) ?? true) && (accept?.(viewOf(entity, undefined)) ?? true);
}

/**
 * One entity of the house, from the interface's entity picker.
 *
 * @param props - The SDK's props.
 * @returns The interface's field.
 */
function EntityField(props: EntityFieldProps) {
  const { domains, accept, onChange, ...rest } = props;

  return (
    <HouseEntityField
      {...rest}
      accept={acceptOf(domains, accept)}
      onChange={(entityId) => {
        onChange(entityId);
      }}
    />
  );
}

/**
 * The interface's entity picker, handing back addresses.
 *
 * @param props - The SDK's props.
 * @returns The interface's picker.
 */
function EntityPicker(props: EntityPickerProps) {
  const { domains, accept, onChoose, ...rest } = props;

  return (
    <HouseEntityPicker
      {...rest}
      accept={acceptOf(domains, accept)}
      onChoose={(entities) => {
        onChoose(entities.map((entity) => entity.entityId));
      }}
    />
  );
}

/**
 * The interface's name-and-icon field, handing back the icon's id.
 *
 * @param props - The SDK's props.
 * @returns The interface's field.
 */
function NameIconField(props: NameIconFieldProps) {
  const { onIconChange, ...rest } = props;

  return (
    <HouseNameIconField
      {...rest}
      onIconChange={(icon) => {
        onIconChange(icon.id);
      }}
    />
  );
}

/**
 * A catalogue icon by its id: the drawing the owner gave it, the space it takes while it is read.
 *
 * @param props - Its id, its size, an svg's attributes.
 * @returns The icon.
 */
function Icon(props: IconProps) {
  const { id, size = 20, ...rest } = props;
  const icon = useCatalogueIcons([id]).get(id);

  return (
    <CatalogueIcon
      {...rest}
      node={icon?.node ?? []}
      frame={icon?.frame ?? { x: 0, y: 0, size: 24 }}
      size={size}
    />
  );
}

/** The interface's `@nebulahome/package-sdk/components`, as a package's build reads it. */
export const COMPONENTS_HOST = {
  Button,
  IconButton,
  Icon,
  Badge,
  Panel,
  PanelRow,
  PanelNote,
  CardHeading,
  Figure,
  StatusDot,
  ProgressBar,
  Hint,
  TextField,
  SelectField,
  Switch,
  Segmented,
  Slider,
  Stepper,
  TagChip,
  Modal,
  IconField,
  EntityField,
  EntityPicker,
  Checkbox,
  RadioGroup,
  Tooltip,
  Calendar,
  DateField,
  NameIconField,
  cn,
} satisfies ComponentsHost;
