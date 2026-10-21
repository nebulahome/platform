/**
 * The mark of a device reached over the house's Matter fabric: a vendor's device, run as Matter,
 * beside the vendor's others.
 */
import { useTranslation } from 'react-i18next';

import { MATTER_TRANSPORT } from '@nebulahome/contracts';
import { Badge } from '@nebulahome/ui';

import { MatterLogo } from '@/components/brand-logos';

/**
 * Renders the mark, for a device on the `matter` transport only.
 *
 * @param props - The device's transport.
 * @param props.transport - It.
 * @returns The badge, or nothing.
 */
export function MatterTag(props: { readonly transport: string }) {
  const { t } = useTranslation();

  return props.transport === MATTER_TRANSPORT ? (
    <Badge size="small" icon={<MatterLogo width={11} height={11} />}>
      {t('library.matterTag', 'Matter')}
    </Badge>
  ) : null;
}
