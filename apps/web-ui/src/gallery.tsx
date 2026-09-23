/**
 * Every shared component, every variant, both themes, on one page.
 *
 * Served by `gallery.html` in development and absent from the build. It is not a route: the
 * application's router is about a home, and a page about the design system is not part of it.
 *
 * What it is for is the thing a design system otherwise has no answer to - somebody changes the
 * badge, and the six settings panels that use it are not open. Here they all are, next to each
 * other, in both themes, so the change is looked at before it lands.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';

import { TAG_COLORS, type TagColor } from '@nebula-home/contracts';
import {
  Badge,
  Button,
  ColorSwatches,
  IconButton,
  Modal,
  Panel,
  PanelNote,
  PanelRow,
  Segmented,
  SelectField,
  TagChip,
  TextField,
  type BadgeTone,
} from '@nebula-home/ui';

import { CheckIcon, CopyIcon, WarningIcon } from '@/components/icons';
import { PasswordField } from '@/components/password-field';
import { AutomationEditor } from '@/routes/library/automation-editor';
import { LibraryTabs } from '@/routes/library/library-tabs';

import './styles/globals.css';

/** What a section needs. */
type SectionProps = {
  /** What it is about. */
  readonly title: string;

  /** A line saying what the reader should notice. */
  readonly note: string;

  /** The specimens. */
  readonly children: ReactNode;
};

/**
 * One group of specimens.
 *
 * @param props - See {@link SectionProps}.
 * @returns The section.
 */
function Section(props: SectionProps) {
  const { title, note, children } = props;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-head font-semibold">{title}</h2>
        <p className="text-caption text-foreground-subtle">{note}</p>
      </div>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

const TONES: readonly BadgeTone[] = ['neutral', 'accent', 'success', 'warning', 'danger'];

/**
 * The gallery.
 *
 * @returns The page.
 */
function Gallery() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [select, setSelect] = useState('member');
  const [segment, setSegment] = useState('system');
  const [password, setPassword] = useState('');
  const [swatch, setSwatch] = useState<TagColor | null>('teal');
  const [openModal, setOpenModal] = useState<'plain' | 'protected' | null>(null);

  // The whole page is themed by the same attribute the application sets on the root, so what is
  // on screen here is what ships rather than an approximation of it. An effect because the root
  // element is outside React, which is the one thing effects are for (RULES.md 15.2).
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  return (
    <div className="min-h-screen bg-canvas px-8 py-10">
      <div className="mx-auto flex max-w-4xl flex-col gap-10">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-head font-semibold">Design system</h1>
            <p className="text-caption text-foreground-subtle">
              Development only. Every variant of every shared component.
            </p>
          </div>

          <Segmented
            label="Theme"
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
            value={theme}
            onChange={setTheme}
          />
        </header>

        <Section title="Type" note="Each step names a job rather than a size.">
          <div className="flex flex-col gap-2">
            <span className="text-label text-foreground-subtle uppercase">Label · 11</span>
            <span className="text-caption text-foreground-subtle">Caption · 12</span>
            <span className="text-ui">Interface · 13</span>
            <span className="text-title font-medium">Title · 14</span>
            <span className="text-subhead font-semibold">Subhead · 16</span>
            <span className="text-head font-semibold">Head · 18</span>
            <span className="text-headline font-semibold">Headline · 20</span>
            <span className="text-reading font-semibold tabular">21.5 · reading</span>
            <span className="text-reading-lg font-semibold tabular">60% · large</span>
            <span className="font-mono text-ui text-foreground-muted">light.hallway_ceiling</span>
          </div>
        </Section>

        <Section
          title="Surfaces"
          note="Ground, rail, card, control, recess — four steps and a hole."
        >
          <div className="flex flex-wrap gap-3">
            <Swatch className="border border-border bg-canvas">canvas</Swatch>
            <Swatch className="border border-border bg-rail">rail</Swatch>
            <Swatch className="border border-border face-card">card</Swatch>
            <Swatch className="border border-border-strong face-raised">raised</Swatch>
            <Swatch className="border border-border face-sunk">sunk</Swatch>
            <Swatch className="face-primary text-primary-foreground">primary</Swatch>
          </div>
        </Section>

        <Section title="Button" note="Three intents, three sizes, and the waiting state.">
          {(['primary', 'ghost', 'danger'] as const).map((variant) => (
            <div key={variant} className="flex items-center gap-3">
              <Button variant={variant} size="compact">
                Compact
              </Button>
              <Button variant={variant}>Medium</Button>
            </div>
          ))}
          <Button isBusy>Saving</Button>
          <Button disabled>Disabled</Button>
          <div className="w-56">
            <Button size="large">Large, and full width</Button>
          </div>
        </Section>

        <Section title="Icon button" note="Named by what pressing it does. The label is required.">
          <IconButton label="Copy the token">
            <CopyIcon width="16" height="16" />
          </IconButton>
          <IconButton label="Copy the token" variant="raised">
            <CopyIcon width="16" height="16" />
          </IconButton>
          <IconButton label="Revoke the token" variant="danger">
            <WarningIcon width="16" height="16" />
          </IconButton>
          <IconButton label="Copy the token" size="small">
            <CopyIcon width="14" height="14" />
          </IconButton>
          <IconButton label="Copy the token" size="large">
            <CopyIcon width="18" height="18" />
          </IconButton>
        </Section>

        <Section title="Badge" note="Five meanings, and never colour alone.">
          {TONES.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
          <Badge tone="success" icon={<CheckIcon width="12" height="12" />}>
            On
          </Badge>
          <Badge tone="warning" size="small">
            small
          </Badge>
        </Section>

        <Section
          title="Tag chip"
          note="Twelve hues and one meaning: a tag the owner made. The dot is there so colour is never the only carrier."
        >
          {TAG_COLORS.map((color) => (
            <TagChip key={color} color={color}>
              {color}
            </TagChip>
          ))}
          <TagChip color="teal" size="small">
            small
          </TagChip>
          <TagChip
            color="pink"
            onRemove={() => {
              // A gallery chip has nowhere to be removed from.
            }}
          >
            removable
          </TagChip>
        </Section>

        <Section
          title="Colour swatches"
          note="The palette as a radio group: arrow keys, one tab stop."
        >
          <ColorSwatches label="Colour" value={swatch} onChange={setSwatch} />
        </Section>

        <Section title="Fields" note="One shape, three sizes, and the same recess in each.">
          <div className="flex w-64 flex-col gap-4">
            <TextField label="Display name" defaultValue="Mattia Carli" />
            <TextField
              label="Email"
              defaultValue="not-an-address"
              error="That is not an address the server will take."
            />
            <TextField label="Compact" size="compact" defaultValue="In a row" />
            <TextField
              label="With a hint"
              hint="Optional, and used for nothing but recognising you."
              defaultValue=""
            />
          </div>

          <div className="flex w-64 flex-col gap-4">
            <SelectField
              label="Role"
              options={[
                { value: 'owner', label: 'Owner' },
                { value: 'admin', label: 'Admin' },
                { value: 'member', label: 'Member' },
                { value: 'guest', label: 'Guest' },
              ]}
              value={select}
              onChange={setSelect}
            />
            <PasswordField label="New password" value={password} onChange={setPassword} />
          </div>
        </Section>

        <Section title="Segmented" note="A choice small enough to show all at once.">
          <Segmented
            label="Theme preference"
            options={[
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
            value={segment}
            onChange={setSegment}
          />
          <Segmented
            label="Compact"
            size="compact"
            options={[
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={segment}
            onChange={setSegment}
          />
        </Section>

        <Section title="Panel" note="The group of rows a settings page is built from.">
          <div className="w-full">
            <Panel title="Account" action={<Button size="compact">Add</Button>}>
              <PanelRow
                title="Display name"
                note="What everyone else sees."
                control={
                  <Button variant="ghost" size="compact">
                    Edit
                  </Button>
                }
              />
              <PanelRow
                title="Two-factor"
                note="An authenticator app, checked at sign-in."
                control={<Badge tone="success">On</Badge>}
              />
              <PanelRow
                title="Opens into something"
                control={
                  <Button variant="danger" size="compact">
                    Revoke
                  </Button>
                }
              >
                <p className="text-ui text-foreground-muted">
                  A row can carry a whole form under its title.
                </p>
              </PanelRow>
              <PanelNote>A tier cannot keep data for less time than the one above it.</PanelNote>
            </Panel>
          </div>
        </Section>

        <Section
          title="Library switch"
          note="Links wearing a pill bar's shape: each view has its own address, so it bookmarks and the back button works."
        >
          <MemoryRouter initialEntries={['/scenes']}>
            <LibraryTabs />
          </MemoryRouter>
        </Section>

        <Section
          title="Automation editor"
          note="The real screen, mounted here because the route behind it needs a session. Reading entities fails without one, which is the path where the entity fields fall back to being typed."
        >
          <div className="h-[38rem] w-full overflow-hidden rounded-panel border border-border">
            <MemoryRouter initialEntries={['/automations/new']}>
              <QueryClientProvider client={new QueryClient()}>
                <AutomationEditor />
              </QueryClientProvider>
            </MemoryRouter>
          </div>
        </Section>

        <Section title="Modal" note="Clicking away closes it, unless what it holds is shown once.">
          <Button
            onClick={() => {
              setOpenModal('plain');
            }}
          >
            Open a dialog
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setOpenModal('protected');
            }}
          >
            Open one that keeps a secret
          </Button>
        </Section>
      </div>

      <Modal
        isOpen={openModal === 'plain'}
        onClose={() => {
          setOpenModal(null);
        }}
        title="Invite somebody"
        description="They will be able to sign in once they have set a password."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOpenModal(null);
              }}
            >
              Cancel
            </Button>
            <Button>Send it</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <TextField label="Username" defaultValue="" />
          {/* The dropdown that used to give the whole dialog a scrollbar. */}
          <SelectField
            label="Role"
            options={[
              { value: 'owner', label: 'Owner' },
              { value: 'admin', label: 'Admin' },
              { value: 'member', label: 'Member' },
              { value: 'guest', label: 'Guest' },
            ]}
            value={select}
            onChange={setSelect}
          />
        </div>
      </Modal>

      <Modal
        isOpen={openModal === 'protected'}
        onClose={() => {
          setOpenModal(null);
        }}
        title="Recovery codes"
        description="Shown once. Clicking away will not dismiss this."
        closesOnBackdrop={false}
        footer={
          <Button
            onClick={() => {
              setOpenModal(null);
            }}
          >
            I have saved them
          </Button>
        }
      >
        <p className="font-mono text-ui text-foreground-muted">4f2a-9c71 · 8be3-1d40</p>
      </Modal>
    </div>
  );
}

/** What a swatch needs. */
type SwatchProps = {
  /** The classes under test. */
  readonly className: string;

  /** What the surface is called. */
  readonly children: ReactNode;
};

/**
 * One surface, labelled.
 *
 * @param props - See {@link SwatchProps}.
 * @returns The swatch.
 */
function Swatch(props: SwatchProps) {
  const { className, children } = props;

  return (
    <div
      className={`flex h-16 w-28 items-end rounded-panel p-2 text-caption text-foreground-muted ${className}`}
    >
      {children}
    </div>
  );
}

const root = document.getElementById('root');

if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
}
