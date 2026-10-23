/**
 * The fields of an HTTP request (board N-Blocks-Actions): the method and the address, the
 * parameters, the headers, the body and how long to wait for an answer.
 *
 * A parameter is an entity's reading under a name, as an expression's variables are, and is put
 * into the address or the body where `{{ name }}` is written - drawn there in its colour, the way
 * an alias's formula draws its sources (`alias-formula-field.tsx`). Renaming one rewrites its
 * uses. A header named Authorization is a password field: the server seals it on save and only
 * says it is kept from then on.
 */
import { useTranslation } from 'react-i18next';

import {
  aliasScalarFromState,
  HTTP_METHODS,
  type AutomationAction,
  type HttpBodyKind,
  type HttpHeader,
  type HttpMethod,
} from '@nebulahome/contracts';
import {
  AppIcon,
  Badge,
  Button,
  cn,
  IconButton,
  Segmented,
  SelectField,
  TextField,
} from '@nebulahome/ui';

import { numberFormat } from '@/i18n/formatters';
import { METHOD_TONES } from '@/lib/http-methods';
import { formatJsonTemplate } from '@/lib/json-template';
import { sourceColors, VARIABLE_PATTERN } from '@/library/alias-sources';
import { partialEntityId } from '@/library/automation-draft';
import {
  AliasFormulaField,
  SOURCE_COLOR_CLASSES,
  templateSegments,
} from '@/routes/library/alias-formula-field';
import { DurationField } from '@/routes/library/automation/duration-field';
import { useEditorHouse } from '@/routes/library/automation/editor-house';
import { EntityField } from '@/routes/library/entity-field';

/** An HTTP request action. */
type HttpRequestAction = Extract<AutomationAction, { type: 'http_request' }>;

/** What the address field shows while empty. */
const URL_EXAMPLE = 'https://hooks.example.com/house/{{ door }}/state';

/** What a JSON body shows while empty. */
const BODY_EXAMPLE = '{ "power_w": {{ power }} }';

/** What a header's name shows while empty: a header name, never translated. */
const HEADER_EXAMPLE = 'Content-Type';

/** What a parameter's hint shows as one, in braces. */
const TOKEN_EXAMPLE = '{{ power }}';

/** The columns of a parameter's row: name, entity, reading, remove. */
const PARAMETER_COLUMNS = 'grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_5rem_auto] gap-2';

/**
 * A text with one parameter's uses renamed.
 *
 * @param text - The address or the body.
 * @param from - The old name.
 * @param to - The new one.
 * @returns The text with `{{ from }}` written `{{ to }}`; unchanged while either is no name.
 */
function renamed(text: string, from: string, to: string): string {
  return VARIABLE_PATTERN.test(from) && VARIABLE_PATTERN.test(to)
    ? text.replaceAll(new RegExp(`\\{\\{\\s*${from}\\s*\\}\\}`, 'gu'), `{{ ${to} }}`)
    : text;
}

/**
 * Whether a header is the one kept secret.
 *
 * @param header - The header.
 * @returns True for Authorization, in any case.
 */
function isSecret(header: HttpHeader): boolean {
  return header.name.toLowerCase() === 'authorization';
}

/**
 * Renders the fields of an HTTP request.
 *
 * @param props - The action and its change handler.
 * @param props.action - The HTTP request.
 * @param props.onChange - Called with it as it now stands.
 * @returns The fields.
 */
export function HttpRequestFields(props: {
  readonly action: HttpRequestAction;
  readonly onChange: (action: AutomationAction) => void;
}) {
  const { t } = useTranslation();

  const { action, onChange } = props;
  const house = useEditorHouse();
  const variables = Object.entries(action.variables ?? {});
  const colors = sourceColors(
    variables.map(([name, entityId], index) => ({
      rowKey: String(index),
      variableName: name,
      entityId,
    })),
  );
  const sources = variables.map(([name], index) => ({
    variableName: name,
    color: colors.get(String(index)) ?? 'blue',
  }));
  const headers = action.headers ?? [];
  const body = action.body ?? { kind: 'none', text: '' };
  const hasBody = action.method !== 'GET' && action.method !== 'HEAD';
  const tidied = body.kind === 'json' ? formatJsonTemplate(body.text) : null;

  /**
   * Writes the parameters back, and a renamed one's uses with them.
   *
   * @param entries - Name and entity, in order.
   * @param rename - The old name and the new, when one was renamed.
   */
  const setVariables = (
    entries: readonly (readonly [string, string])[],
    rename?: readonly [string, string],
  ): void => {
    /**
     * Renames the uses in one text.
     *
     * @param text - The address or the body.
     * @returns It renamed.
     */
    const follow = (text: string): string =>
      rename === undefined ? text : renamed(text, rename[0], rename[1]);

    onChange({
      ...action,
      url: follow(action.url),
      variables: Object.fromEntries(entries),
      ...(action.body === undefined
        ? {}
        : { body: { ...action.body, text: follow(action.body.text) } }),
    });
  };

  /**
   * Writes the headers back.
   *
   * @param next - The headers, in order.
   */
  const setHeaders = (next: readonly HttpHeader[]): void => {
    onChange({ ...action, headers: [...next] });
  };

  /**
   * Writes the body back.
   *
   * @param next - What changes.
   */
  const setBody = (next: Partial<{ kind: HttpBodyKind; text: string }>): void => {
    onChange({ ...action, body: { ...body, ...next } });
  };

  return (
    <>
      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-2">
        <SelectField
          label={t('library.httpRequestFields.method', 'Method')}
          isLabelHidden
          options={HTTP_METHODS.map((method) => ({
            value: method,
            label: method,
            leading: (
              <span className={cn('size-2 rounded-full bg-current', METHOD_TONES[method])} />
            ),
          }))}
          value={action.method}
          onChange={(method) => {
            onChange({ ...action, method: method as HttpMethod });
          }}
        />
        <AliasFormulaField
          label={t('library.httpRequestFields.address', 'Address')}
          isLabelHidden
          required
          minRows={1}
          placeholder={URL_EXAMPLE}
          paint={templateSegments}
          sources={sources}
          value={action.url}
          onChange={(url) => {
            onChange({ ...action, url: url.replaceAll(/[\r\n]/gu, '') });
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-caption font-medium text-foreground-muted">
          {t('library.httpRequestFields.parameters', 'Parameters')}
        </span>
        {variables.length === 0 ? null : (
          <div
            className={cn(
              PARAMETER_COLUMNS,
              'font-mono text-label text-foreground-subtle uppercase',
            )}
          >
            <span>{t('library.httpRequestFields.name', 'Name')}</span>
            <span>{t('library.httpRequestFields.entity', 'Entity')}</span>
            <span className="text-right">{t('library.httpRequestFields.now', 'Now')}</span>
            <span />
          </div>
        )}
        {variables.map(([name, entityId], index) => {
          const reading =
            entityId === '' ? undefined : aliasScalarFromState(house.stateOf(entityId));

          return (
            <div
              key={`parameter-${String(index)}`}
              className={cn(PARAMETER_COLUMNS, 'items-center')}
            >
              <TextField
                label={t('library.httpRequestFields.name', 'Name')}
                isLabelHidden
                size="compact"
                className={cn('font-mono', SOURCE_COLOR_CLASSES[sources[index]?.color ?? 'blue'])}
                value={name}
                onChange={(event) => {
                  const next = event.target.value.toLowerCase();

                  setVariables(
                    variables.map((entry, at) => (at === index ? [next, entry[1]] : entry)),
                    [name, next],
                  );
                }}
              />
              <EntityField
                label={t('library.httpRequestFields.entityForName', 'Entity for {{name}}', {
                  name,
                })}
                isLabelHidden
                value={entityId}
                onChange={(next) => {
                  setVariables(
                    variables.map((entry, at) =>
                      at === index ? [entry[0], partialEntityId(next)] : entry,
                    ),
                  );
                }}
              />
              <span className="truncate text-right font-mono text-caption text-foreground-muted">
                {reading === undefined
                  ? '-'
                  : typeof reading === 'number'
                    ? numberFormat({ maximumFractionDigits: 2 }).format(reading)
                    : String(reading)}
              </span>
              <IconButton
                label={t('library.httpRequestFields.removeName', 'Remove {{name}}', { name })}
                variant="danger"
                size="small"
                onClick={() => {
                  setVariables(variables.filter((entry) => entry !== variables[index]));
                }}
              >
                <AppIcon id="x" size={13} />
              </IconButton>
            </div>
          );
        })}
        <Button
          variant="ghost"
          size="compact"
          className="self-start"
          disabled={variables.length >= 16}
          onClick={() => {
            setVariables([...variables, [`value_${String(variables.length + 1)}`, '']]);
          }}
        >
          <AppIcon id="plus" size={13} />
          {t('library.httpRequestFields.addAParameter', 'Add a parameter')}
        </Button>
        <span className="text-caption text-foreground-subtle">
          {t(
            'library.httpRequestFields.parametersHint',
            'Put a parameter in the address or the body by typing its name between braces, {{example}}; it shows in its colour. Rename it here and every use follows.',
            { example: TOKEN_EXAMPLE },
          )}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-caption font-medium text-foreground-muted">
          {t('library.httpRequestFields.headers', 'Headers')}
        </span>
        {headers.map((header, index) => (
          <div
            key={`header-${String(index)}`}
            className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] items-center gap-2"
          >
            <TextField
              label={t('library.httpRequestFields.headerName', 'Header name')}
              isLabelHidden
              size="compact"
              className="font-mono"
              placeholder={HEADER_EXAMPLE}
              value={header.name}
              onChange={(event) => {
                setHeaders(
                  headers.map((entry, at) =>
                    at === index ? { ...entry, name: event.target.value } : entry,
                  ),
                );
              }}
            />
            <div className="relative">
              <TextField
                label={t('library.httpRequestFields.headerValue', 'Value of {{name}}', {
                  name: header.name,
                })}
                isLabelHidden
                size="compact"
                className={cn('font-mono', isSecret(header) ? 'pr-24' : undefined)}
                type={isSecret(header) ? 'password' : 'text'}
                autoComplete={isSecret(header) ? 'new-password' : 'off'}
                placeholder={typeof header.value === 'string' ? undefined : '••••••••••••'}
                value={typeof header.value === 'string' ? header.value : ''}
                onChange={(event) => {
                  setHeaders(
                    headers.map((entry, at) =>
                      at === index ? { ...entry, value: event.target.value } : entry,
                    ),
                  );
                }}
              />
              {isSecret(header) ? (
                <Badge
                  size="small"
                  icon={<AppIcon id="lock" size={11} />}
                  className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2"
                >
                  {t('library.httpRequestFields.secret', 'Secret')}
                </Badge>
              ) : null}
            </div>
            <IconButton
              label={t('library.httpRequestFields.removeHeader', 'Remove {{name}}', {
                name: header.name,
              })}
              variant="danger"
              size="small"
              onClick={() => {
                setHeaders(headers.filter((entry) => entry !== header));
              }}
            >
              <AppIcon id="x" size={13} />
            </IconButton>
          </div>
        ))}
        <Button
          variant="ghost"
          size="compact"
          className="self-start"
          disabled={headers.length >= 20}
          onClick={() => {
            setHeaders([...headers, { name: '', value: '' }]);
          }}
        >
          <AppIcon id="plus" size={13} />
          {t('library.httpRequestFields.addAHeader', 'Add a header')}
        </Button>
        <span className="text-caption text-foreground-subtle">
          {t(
            'library.httpRequestFields.secretHint',
            'A header named Authorization is kept secret on its own: stored encrypted, never shown again.',
          )}
        </span>
      </div>

      {hasBody ? (
        <div className="flex flex-col gap-2">
          <span className="text-caption font-medium text-foreground-muted">
            {t('library.httpRequestFields.body', 'Body')}
          </span>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label={t('library.httpRequestFields.body', 'Body')}
              size="compact"
              options={[
                { value: 'none', label: t('library.httpRequestFields.none', 'None') },
                { value: 'json', label: 'JSON' },
                { value: 'form', label: t('library.httpRequestFields.form', 'Form') },
                { value: 'text', label: t('library.httpRequestFields.text', 'Text') },
              ]}
              value={body.kind}
              onChange={(kind) => {
                setBody({ kind });
              }}
            />
            {body.kind === 'json' && body.text.trim() !== '' ? (
              <span className="flex items-center gap-3 text-caption">
                <span
                  className={cn(
                    'flex items-center gap-1.5',
                    tidied === null ? 'text-warning' : 'text-success',
                  )}
                >
                  <AppIcon id={tidied === null ? 'triangle-alert' : 'check'} size={12} />
                  {tidied === null
                    ? t('library.httpRequestFields.notJson', 'Not valid JSON')
                    : t('library.httpRequestFields.validJson', 'Valid JSON')}
                </span>
                <Button
                  variant="ghost"
                  size="compact"
                  disabled={tidied === null}
                  onClick={() => {
                    setBody({ text: tidied ?? body.text });
                  }}
                >
                  <AppIcon id="braces" size={13} />
                  {t('library.httpRequestFields.format', 'Format')}
                </Button>
              </span>
            ) : null}
          </div>
          {body.kind === 'none' ? null : (
            <AliasFormulaField
              label={t('library.httpRequestFields.body', 'Body')}
              isLabelHidden
              minRows={4}
              placeholder={body.kind === 'json' ? BODY_EXAMPLE : ''}
              paint={templateSegments}
              sources={sources}
              value={body.text}
              hint={t(
                'library.httpRequestFields.bodyHint',
                'Format tidies the indentation. Parameters are sent as numbers, text or true/false, as the entity reports them.',
              )}
              onChange={(text) => {
                setBody({ text });
              }}
            />
          )}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <DurationField
          label={t('library.httpRequestFields.timeOutAfter', 'Time out after')}
          maxMs={60_000}
          value={action.timeoutMs}
          onChange={(timeoutMs) => {
            onChange({ ...action, timeoutMs: timeoutMs ?? 10_000 });
          }}
        />
      </div>
    </>
  );
}
