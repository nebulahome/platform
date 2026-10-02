/**
 * The interface's implementation of `@nebulahome/package-sdk/components` (PACKAGES_DOCS.md 7.1):
 * the design system's own components, lent to a package as they are, and the catalogue's icons.
 *
 * {@link COMPONENTS_HOST} is checked against the SDK's `ComponentsHost`: each facade's props must
 * be accepted by the component lent for it, so the SDK cannot promise a prop the interface would
 * ignore.
 */
import type { ComponentsHost, IconProps } from '@nebulahome/package-sdk/components';
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
  cn,
} satisfies ComponentsHost;
