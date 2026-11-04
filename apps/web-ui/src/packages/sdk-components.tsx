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
} from '@nebulahome/package-sdk/components';
import {
  Badge,
  Button,
  CardHeading,
  CatalogueIcon,
  cn,
  Figure,
  Hint,
  IconButton,
  Modal,
  Panel,
  PanelNote,
  PanelRow,
  ProgressBar,
  Segmented,
  SelectField,
  Slider,
  StatusDot,
  Stepper,
  Switch,
  TagChip,
  TextField,
} from '@nebulahome/ui';

import { useCatalogueIcons } from '@/routes/library/device-icon';
import { EntityField as HouseEntityField } from '@/routes/library/entity-field';
import { EntityPicker as HouseEntityPicker } from '@/routes/library/entity-picker/entity-picker';
import { IconField } from '@/routes/library/icon-field';

/**
 * What a package's `domains` lets be chosen.
 *
 * @param domains - The domains, or undefined for any.
 * @returns The interface's `accept`, or undefined for every entity.
 */
function acceptOf(
  domains: readonly string[] | undefined,
): ((entity: EntityView) => boolean) | undefined {
  return domains === undefined ? undefined : (entity) => domains.includes(entity.domain);
}

/**
 * One entity of the house, from the interface's entity picker.
 *
 * @param props - The SDK's props.
 * @returns The interface's field.
 */
function EntityField(props: EntityFieldProps) {
  const { domains, onChange, ...rest } = props;

  return (
    <HouseEntityField
      {...rest}
      accept={acceptOf(domains)}
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
  const { domains, onChoose, ...rest } = props;

  return (
    <HouseEntityPicker
      {...rest}
      accept={acceptOf(domains)}
      onChoose={(entities) => {
        onChoose(entities.map((entity) => entity.entityId));
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
  cn,
} satisfies ComponentsHost;
