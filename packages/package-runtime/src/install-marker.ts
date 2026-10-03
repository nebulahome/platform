/**
 * How an installed vendor's folder says which build of it is the one to load.
 *
 * A vendor the platform installs is unpacked into a folder of its own build -
 * `hub/integrations/<vendor>/<build>/` - never over the build before. Node keeps every module it
 * has imported for the life of the process, keyed by its address, and a module that imports a
 * sibling (`./coiot.js`) reaches it by an address the importer does not choose: a build unpacked
 * over the one before would hand the new transport the old helper, whose socket the old vendor's
 * release has just closed. A folder per build gives every file a new address, so `hub` can load
 * an update beside the build that runs and swap the two without restarting.
 *
 * The marker, `<vendor>/.nebula-install.json`, names the current build and how it arrived
 * (`integrationInstallSchema`, in contracts: it crosses the bus). It is written by the
 * packet-manager last, once `hub` has loaded the build, and read by `hub` at start and by the
 * catalogue; the folder and the marker are backed up together, so a restored house loads what it
 * ran. A vendor folder without a marker is read as it stands - a bundle under development, or one
 * put there by hand.
 */
import { integrationInstallSchema, type IntegrationInstall } from '@nebulahome/contracts';

/** The marker's name, in the vendor's folder. */
export const INSTALL_MARKER_FILE = '.nebula-install.json';

/** The contents of `.nebula-install.json`. */
export const installMarkerSchema = integrationInstallSchema;

/** The contents of `.nebula-install.json`. */
export type InstallMarker = IntegrationInstall;
