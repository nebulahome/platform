/**
 * Who may connect, and who is connected: the platform's principals, each device's, and anyone
 * anonymous - with **Add client**, which makes a username and a password for a device.
 *
 * The password is shown once, when it is made, with a way to copy it and a line for a device's
 * settings: it is kept only as a hash, and a device that lost it is given a new client.
 */
import { useState } from 'react';

import { usePackageCall, usePackageRpc } from '@nebula-home/package-ui';
import {
  Badge,
  Button,
  Modal,
  Panel,
  PanelNote,
  PanelRow,
  Segmented,
  TextField,
  type BadgeTone,
} from '@nebula-home/ui';

import { ago, copy, type ClientPrincipal, type ClientsReply } from './types.js';

/** How often the list is read again. */
const REFRESH_MS = 5000;

/** What each kind of principal reads as. */
const KINDS: Readonly<Record<ClientPrincipal['kind'], { label: string; tone: BadgeTone }>> = {
  hub: { label: 'Platform', tone: 'neutral' },
  container: { label: 'Container', tone: 'neutral' },
  client: { label: 'Device', tone: 'accent' },
};

/** What a new client may reach. */
type AccessChoice = 'prefix' | 'all';

/** The access choices. */
const ACCESS_OPTIONS: readonly { value: AccessChoice; label: string }[] = [
  { value: 'prefix', label: 'Its own topics' },
  { value: 'all', label: 'Every topic' },
];

/**
 * A sentence for what a principal may reach.
 *
 * @param principal - The principal.
 * @returns The sentence.
 */
function reachOf(principal: ClientPrincipal): string {
  return principal.publish.includes('#') ? 'every topic' : principal.publish.join(', ');
}

/** What the dialog needs. */
type AddClientDialogProps = {
  readonly isOpen: boolean;
  readonly port: number;
  readonly onClose: () => void;
  readonly onAdded: () => void;
};

/**
 * Makes a client for a device, and shows its password once.
 *
 * @param props - See {@link AddClientDialogProps}.
 * @returns The dialog.
 */
function AddClientDialog(props: AddClientDialogProps) {
  const { isOpen, port, onClose, onAdded } = props;
  const call = usePackageCall();
  const [username, setUsername] = useState('');
  const [label, setLabel] = useState('');
  const [access, setAccess] = useState<AccessChoice>('prefix');
  const [made, setMade] = useState<{ username: string; password: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);
  const [isCopied, setCopied] = useState(false);
  const host = globalThis.location.hostname;

  /** Shuts the dialog and starts it afresh next time. */
  const close = (): void => {
    setUsername('');
    setLabel('');
    setAccess('prefix');
    setMade(null);
    setProblem(null);
    setCopied(false);
    onClose();
  };

  /** Makes the client. */
  const add = (): void => {
    setBusy(true);
    setProblem(null);
    call<{ username: string; password: string }>('addClient', { username, label, access })
      .then((reply) => {
        setMade(reply);
        onAdded();
      })
      .catch((error: unknown) => {
        setProblem(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      closesOnBackdrop={made === null}
      title={made === null ? 'Add a client' : `${made.username} can connect`}
      description={
        made === null
          ? 'A username and a password for one device. Each device gets its own.'
          : 'Put these in the device. The password is shown this once.'
      }
      footer={
        made === null ? (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button isBusy={isBusy} disabled={username === '' || isBusy} onClick={add}>
              Add
            </Button>
          </>
        ) : (
          <Button onClick={close}>Done</Button>
        )
      }
    >
      {made === null ? (
        <div className="flex flex-col gap-4">
          <TextField
            label="Username"
            value={username}
            placeholder="garden-sensor"
            hint={
              access === 'prefix'
                ? `It publishes under ${username === '' ? '<username>' : username}/ and announces itself for discovery.`
                : 'It reads and writes every topic.'
            }
            onChange={(event) => {
              setUsername(event.target.value.toLowerCase());
            }}
          />
          <TextField
            label="What it is"
            value={label}
            placeholder="The Tasmota plug in the garden"
            onChange={(event) => {
              setLabel(event.target.value);
            }}
          />
          <Segmented
            label="Reaches"
            size="compact"
            className="self-start"
            options={ACCESS_OPTIONS}
            value={access}
            onChange={setAccess}
          />
          {problem === null ? null : (
            <p role="alert" className="text-ui text-danger">
              {problem}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-ui">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
            <dt className="text-foreground-subtle">Host</dt>
            <dd className="font-mono break-all">{host}</dd>
            <dt className="text-foreground-subtle">Port</dt>
            <dd className="font-mono">{port}</dd>
            <dt className="text-foreground-subtle">Username</dt>
            <dd className="font-mono break-all">{made.username}</dd>
            <dt className="text-foreground-subtle">Password</dt>
            <dd className="font-mono break-all">{made.password}</dd>
          </dl>
          <Button
            variant="ghost"
            size="compact"
            className="self-start"
            onClick={() => {
              void copy(made.password).then(setCopied);
            }}
          >
            {isCopied ? 'Copied' : 'Copy the password'}
          </Button>
        </div>
      )}
    </Modal>
  );
}

/**
 * Renders the clients.
 *
 * @param props - The broker's port, for the dialog.
 * @param props.port - It.
 * @returns The panel.
 */
export function ClientsPanel(props: { readonly port: number }) {
  const clients = usePackageRpc<ClientsReply>('clients', null, { refetchIntervalMs: REFRESH_MS });
  const call = usePackageCall();
  const [isAdding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const principals = clients.data?.principals ?? [];
  const anonymous = clients.data?.anonymous ?? [];

  /**
   * Removes a device's client.
   *
   * @param username - Which.
   */
  const remove = (username: string): void => {
    setProblem(null);
    call('removeClient', { username })
      .then(() => {
        clients.refetch();
      })
      .catch((error: unknown) => {
        setProblem(error instanceof Error ? error.message : String(error));
      });
  };

  return (
    <Panel
      title={`Clients · ${String(principals.length)}`}
      action={
        <Button
          size="compact"
          onClick={() => {
            setAdding(true);
          }}
        >
          Add client
        </Button>
      }
    >
      {principals.map((principal) => {
        const kind = KINDS[principal.kind];
        const online = principal.sessions.length;

        return (
          <PanelRow
            key={principal.username}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{principal.username}</span>
                <Badge tone={kind.tone} size="small">
                  {kind.label}
                </Badge>
                <Badge tone={online > 0 ? 'success' : 'neutral'} size="small">
                  {online > 0 ? 'Online' : 'Offline'}
                </Badge>
              </span>
            }
            note={
              <span className="flex flex-col gap-0.5">
                <span>
                  {principal.label} · reaches {reachOf(principal)}
                </span>
                {principal.sessions.map((session) => (
                  <span key={session.clientId} className="text-foreground-subtle">
                    {session.clientId}
                    {session.address === null ? '' : ` from ${session.address}`} ·{' '}
                    {ago(session.connectedAt)}
                  </span>
                ))}
              </span>
            }
            control={
              principal.kind === 'client' ? (
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={() => {
                    remove(principal.username);
                  }}
                >
                  Remove
                </Button>
              ) : null
            }
          />
        );
      })}

      {anonymous.length === 0 ? null : (
        <PanelRow
          title="Without a username"
          note={anonymous
            .map(
              (session) =>
                `${session.clientId}${session.address === null ? '' : ` from ${session.address}`}`,
            )
            .join(', ')}
        />
      )}

      {problem === null ? null : <PanelNote>{problem}</PanelNote>}
      {principals.length === 0 && clients.data !== undefined ? (
        <PanelNote>Nobody may connect yet. Add a client for each device.</PanelNote>
      ) : null}

      <AddClientDialog
        isOpen={isAdding}
        port={props.port}
        onClose={() => {
          setAdding(false);
        }}
        onAdded={clients.refetch}
      />
    </Panel>
  );
}
