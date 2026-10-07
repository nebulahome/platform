/**
 * Writing a compose project: a new one, or a change to one deployed from here.
 *
 * The file is written in the page - a YAML editor, line numbers and all - or uploaded, which puts
 * the file in the editor to be read before anything runs. Its `.env`, the values the file fills
 * itself in with, is a second editor folded under the first, since most files have none.
 *
 * **Check** asks `docker compose` what it makes of the file without running anything, and marks
 * what it refuses on the line it names; **Deploy** keeps the file and brings the project up,
 * answering at once while the images are pulled - the project's card and its page follow that.
 * A file that cannot run is refused by Deploy too, with the same marks, so nothing half-kept is
 * left behind.
 *
 * Laid out as the board draws it: the project's name and Paste / Upload a file on the left, the
 * editor under a bar naming the file and saying "Valid · 3 services" once checked; on the right,
 * the services found. The board's second step - each service's ports and folders, the variables to
 * fill - needs `docker compose` to say more than the names of the services, and waits for it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import {
  composeProblemSchema,
  COMPOSE_PROJECT_PATTERN,
  PLATFORM_COMPOSE_PROJECT,
  type ComposeProblem,
} from '@nebulahome/contracts';
import { AppIcon, Button, Modal, Segmented, TextField } from '@nebulahome/ui';

import {
  CONTAINER_QUERY_KEYS,
  deployCompose,
  fetchCompose,
  validateCompose,
} from '@/containers/api';
import { isApiError } from '@/lib/api-error';
import { toMessage } from '@/lib/error-message';
import { composePath } from '@/routes/containers/container-card';

/** The editor, loaded when a dialog that writes a file first opens. */
const YamlEditor = lazy(async () => import('@/routes/containers/yaml-editor'));

/** What the dialog is for: a new project, or a change to one; null while it is shut. */
export type ComposeTarget =
  { readonly kind: 'new' } | { readonly kind: 'edit'; readonly project: string };

/** What a new file starts as. */
const EXAMPLE = `services:
  web:
    image: nginx:alpine
    ports:
      - "8088:80"
    volumes:
      - ./html:/usr/share/nginx/html:ro
    restart: unless-stopped
`;

/**
 * A project's name made of what compose allows.
 *
 * @param text - A file's name, or what the file calls itself.
 * @returns The name, or an empty string when nothing is left.
 */
export function projectNameOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/\.(ya?ml)$/, '')
    .replace(/^(docker-)?compose[._-]?/, '')
    .replaceAll(/[^a-z0-9_-]+/g, '-')
    .replaceAll(/^[^a-z0-9]+|-+$/g, '')
    .slice(0, 63);
}

/**
 * What a file calls its project: its top-level `name:`.
 *
 * @param file - The file.
 * @returns The name, or null when it gives none.
 */
export function declaredName(file: string): string | null {
  const match = /^name:\s*["']?([A-Za-z0-9][\w-]*)["']?\s*$/m.exec(file);

  return match?.[1] === undefined ? null : projectNameOf(match[1]);
}

/**
 * The problems an answer carries: the compose file's, in `details.problems`.
 *
 * @param error - What the server answered.
 * @returns The problems, none when it said something else.
 */
function problemsOf(error: unknown): ComposeProblem[] {
  if (!isApiError(error)) {
    return [];
  }

  const parsed = composeProblemSchema.array().safeParse(error.details['problems']);

  return parsed.success ? parsed.data : [];
}

/** What the form needs. */
type ComposeFormProps = {
  /** The project being changed; null for a new one. */
  readonly project: string | null;
  readonly initialFile: string;
  readonly initialEnv: string;
  readonly onClose: () => void;
};

/**
 * The dialog's form, once there is a file to start from.
 *
 * @param props - See {@link ComposeFormProps}.
 * @returns The form, in its dialog.
 */
function ComposeForm(props: ComposeFormProps) {
  const { project: existing, initialFile, initialEnv, onClose } = props;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const upload = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState(existing ?? '');
  const [isNamed, setNamed] = useState(existing !== null);
  const [file, setFile] = useState(initialFile);
  const [env, setEnv] = useState(initialEnv);
  const [isEnvShown, setEnvShown] = useState(initialEnv !== '');
  const [problems, setProblems] = useState<readonly ComposeProblem[]>([]);
  const [checked, setChecked] = useState<readonly string[] | null>(null);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [source, setSource] = useState<'paste' | 'upload'>('paste');

  /**
   * Checks the project's name before it is sent.
   *
   * @returns The name, or null when it cannot be one.
   */
  const checkName = (): string | null => {
    const name = project.trim();

    if (!COMPOSE_PROJECT_PATTERN.test(name)) {
      setNameError('Lower-case letters, digits, dashes and underscores');

      return null;
    }

    if (name === PLATFORM_COMPOSE_PROJECT) {
      setNameError("That is the platform's own project");

      return null;
    }

    setNameError(undefined);

    return name;
  };

  const check = useMutation({
    mutationFn: validateCompose,

    /**
     * Marks what is wrong, or says which services it found.
     *
     * @param answer - What `docker compose` made of the file.
     */
    onSuccess: (answer) => {
      setProblems(answer.problems);
      setChecked(answer.problems.length === 0 ? answer.services : null);
    },
  });
  const deploy = useMutation({
    /**
     * Keeps the file and brings the project up.
     *
     * @param name - The project.
     * @returns Once it is kept; the rest goes on after.
     */
    mutationFn: async (name: string) =>
      deployCompose({ project: name, file, env }, existing === null),

    /**
     * Closes, and goes to the project's page, where its deployment shows.
     *
     * @param unused - Nothing.
     * @param name - The project.
     */
    onSuccess: (unused, name) => {
      void queryClient.invalidateQueries({ queryKey: CONTAINER_QUERY_KEYS.all });
      onClose();
      void navigate(composePath(name));
    },

    /**
     * Marks what is wrong, when that is why.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      setProblems(problemsOf(error));
      setChecked(null);
    },
  });

  /**
   * Replaces the file, and names the project after it while nobody has named it.
   *
   * @param text - The new file.
   * @param fileName - The uploaded file's name, when it was uploaded.
   */
  const replaceFile = (text: string, fileName?: string): void => {
    setFile(text);
    setProblems([]);
    setChecked(null);

    if (!isNamed) {
      const name = declaredName(text) ?? (fileName === undefined ? '' : projectNameOf(fileName));

      if (name !== '') {
        setProject(name);
      }
    }
  };

  const busy = check.isPending || deploy.isPending;
  const failure =
    deploy.error !== null && problemsOf(deploy.error).length === 0
      ? toMessage(deploy.error)
      : check.error === null
        ? null
        : toMessage(check.error);

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="xlarge"
      layout="sections"
      title={existing === null ? 'Install a compose project' : `Change ${existing}`}
      description={
        existing === null
          ? 'Its folders are kept in NebulaHome’s data, and backed up.'
          : 'Deploying again makes only the services that changed again.'
      }
      footer={
        <>
          <Button variant="bare" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <span className="flex items-center gap-2.5">
            {failure === null ? null : (
              <span role="alert" className="text-ui-sm text-danger">
                {failure}
              </span>
            )}
            <Button
              variant="ghost"
              isBusy={check.isPending}
              disabled={busy || file.trim() === ''}
              onClick={() => {
                const name = checkName();

                if (name !== null) {
                  check.mutate({ project: name, file, env });
                }
              }}
            >
              Check
            </Button>
            <Button
              isBusy={deploy.isPending}
              disabled={busy || file.trim() === ''}
              onClick={() => {
                const name = checkName();

                if (name !== null) {
                  deploy.mutate(name);
                }
              }}
            >
              <AppIcon id="download" size={15} />
              Deploy
            </Button>
          </span>
        </>
      }
    >
      <div className="grid min-h-0 grow lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 px-6 py-5 lg:col-span-2">
          <div className="flex flex-wrap items-end gap-3">
            <TextField
              label="Project name"
              value={project}
              disabled={existing !== null}
              error={nameError}
              className="font-mono"
              placeholder="media"
              onChange={(event) => {
                setProject(event.target.value.toLowerCase());
                setNamed(true);
              }}
            />
            <Segmented
              label="Where the file comes from"
              options={[
                { value: 'paste', label: 'Paste' },
                { value: 'upload', label: 'Upload a file' },
              ]}
              value={source}
              onChange={(next) => {
                setSource(next);
                if (next === 'upload') {
                  upload.current?.click();
                }
              }}
            />
            <input
              ref={upload}
              type="file"
              accept=".yml,.yaml,application/yaml,text/yaml"
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                const picked = event.target.files?.[0];

                if (picked !== undefined) {
                  void picked.text().then((text) => {
                    replaceFile(text, picked.name);
                    setSource('paste');
                  });
                }

                event.target.value = '';
              }}
            />
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-inner border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-caption">
              <span className="flex items-center gap-2 text-foreground-muted">
                <AppIcon id="type" size={13} />
                compose.yaml
              </span>
              {checked === null ? null : (
                <span role="status" className="flex items-center gap-1.5 text-success">
                  <AppIcon id="check" size={13} />
                  Valid · {checked.length} {checked.length === 1 ? 'service' : 'services'}
                </span>
              )}
            </div>
            <Suspense
              fallback={
                <div className="h-64 bg-surface-raised px-3 py-2 text-ui text-foreground-subtle">
                  Opening the editor…
                </div>
              }
            >
              <YamlEditor
                label="Compose file"
                value={file}
                problems={problems}
                onChange={(text) => {
                  setFile(text);
                  setChecked(null);
                }}
              />
            </Suspense>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              aria-expanded={isEnvShown}
              onClick={() => {
                setEnvShown(!isEnvShown);
              }}
              className="self-start text-ui font-medium text-primary transition-colors hover:text-primary-hover"
            >
              {isEnvShown
                ? 'Hide the .env file'
                : env === ''
                  ? 'Add a .env file'
                  : 'Show the .env file'}
            </button>
            {isEnvShown ? (
              <Suspense fallback={null}>
                <YamlEditor
                  label="The .env file"
                  value={env}
                  minHeight="5rem"
                  maxHeight="12rem"
                  placeholder="TZ=Europe/Rome"
                  onChange={(text) => {
                    setEnv(text);
                    setChecked(null);
                  }}
                />
              </Suspense>
            ) : null}
          </div>

          {problems.length === 0 ? null : (
            <ul
              role="alert"
              className="flex flex-col gap-1 rounded-field border border-danger-line bg-danger-soft px-3.5 py-2.5 text-ui text-danger"
            >
              {problems.map((problem, index) => (
                // The same message can come twice, for two services.
                <li key={`${String(index)}-${problem.message}`}>
                  {problem.line === null ? null : (
                    <span className="mr-1.5 font-mono text-caption">line {problem.line}</span>
                  )}
                  {problem.message}
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside
          aria-label="Services found"
          className="flex flex-col gap-3 border-t border-border px-6 py-5 lg:border-t-0 lg:border-l"
        >
          <h3 className="font-mono text-label text-foreground-subtle uppercase">Services found</h3>
          {checked === null ? (
            <p className="text-ui-sm text-foreground-subtle">
              Check the file: what it runs is listed here.
            </p>
          ) : (
            <ul className="flex flex-col">
              {checked.map((service) => (
                <li
                  key={service}
                  className="flex items-center gap-3 border-t border-border py-3 first:border-t-0"
                >
                  <span className="flex size-9 items-center justify-center rounded-field border border-border-strong bg-surface-raised text-cyan">
                    <AppIcon id="container" size={16} />
                  </span>
                  <span className="truncate font-mono text-mono-ui text-foreground">{service}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </Modal>
  );
}

/** What the dialog needs. */
export type ComposeEditorDialogProps = {
  readonly target: ComposeTarget | null;
  readonly onClose: () => void;
};

/**
 * Renders the dialog: at once for a new project, once its file is read for a change.
 *
 * @param props - See {@link ComposeEditorDialogProps}.
 * @returns The dialog, or nothing while it is shut.
 */
export function ComposeEditorDialog(props: ComposeEditorDialogProps) {
  const { target, onClose } = props;
  const project = target?.kind === 'edit' ? target.project : null;
  const document = useQuery({
    queryKey: CONTAINER_QUERY_KEYS.compose(project ?? ''),
    enabled: project !== null,

    /**
     * Reads the project's file.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The file and its `.env`.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchCompose(project ?? '', signal),
  });

  if (target === null) {
    return null;
  }

  if (target.kind === 'new') {
    return <ComposeForm project={null} initialFile={EXAMPLE} initialEnv="" onClose={onClose} />;
  }

  if (document.data === undefined) {
    return (
      <Modal isOpen onClose={onClose} title={`Change ${target.project}`} size="small">
        <p className="px-5 py-4 text-ui text-foreground-muted">
          {document.error === null ? 'Reading the file…' : toMessage(document.error)}
        </p>
      </Modal>
    );
  }

  return (
    <ComposeForm
      key={document.data.updatedAt.toISOString()}
      project={target.project}
      initialFile={document.data.file}
      initialEnv={document.data.env}
      onClose={onClose}
    />
  );
}
