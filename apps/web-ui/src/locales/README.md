# The interface's catalogues

One JSON file per language the interface speaks besides English: `it.json`. English is not a
file - every string is written in English where it is used, and that English is what any language
shows for a key its catalogue lacks (RULES.md 1).

## Saying a string

```tsx
const { t } = useTranslation();

t('devices.empty', 'No devices yet');
t('devices.named', 'Devices of {{name}}', { name });
t('devices.count', {
  count,
  defaultValue_one: '{{count}} device',
  defaultValue_other: '{{count}} devices',
});
<Trans i18nKey="devices.help" defaults="Read <0>the guide</0>" components={[<a href="…" />]} />;
```

- **Keys** are English identifiers, nested by where they are said: `settings.language.title`,
  `devices.list.empty`. A key is a string or the start of others, never both.
- **The English** is written beside every key, literally. A key says one thing in English
  wherever it is used.
- **Plurals** give their English in `defaultValue_one` and `defaultValue_other`; the catalogue
  has every form its language has - Italian `_one`, `_many` (a million and up) and `_other`.
- **Tables built at module scope** - the rail's groups, the settings sections - declare their
  labels with `defineMessage('key', 'English')` and say them with `text(message)` when drawn.
- **Plain functions** that build a sentence for a component use `translate('key', 'English')`.
- **Numbers, dates, lists and sorting** go through `@/i18n/formatters`, never a formatter built at
  module scope or a fixed `'en-GB'`.

## Never translated

- **Logs**: every line, its level (`error`, `warn`, `info`, …), the names of services and
  loggers, and what they say. The log viewer's own controls are translated; the lines are not.
- **Data**: names of devices, entities, areas, scenes, automations; the states and texts that
  integrations and packages report; anything a person typed.
- **What integrations say**: their setup forms, descriptions and messages stay in English.
- **The server's sentences**: an error's `message` is shown as the API wrote it unless the
  interface knows its `code` or `details.reason`.
- **Names of languages** in a language picker: each in its own language (`LOCALE_NAMES`).

## Checks

`pnpm --filter @nebulahome/web-ui lint` runs `check:translations`: every key is written out with
its English, every catalogue has every key in every plural form and nothing stale, placeholders
match, and no letter outside ASCII appears in the code outside this folder. The lint rule
`nebula/no-untranslated-text` finds words written straight into JSX.

## Italian glossary

Use these words, the same way everywhere.

| English            | Italiano      |
| ------------------ | ------------- |
| alias              | alias         |
| area               | area          |
| automation         | automazione   |
| backup             | backup        |
| card               | scheda        |
| condition          | condizione    |
| container          | container     |
| dashboard          | dashboard     |
| device             | dispositivo   |
| entity             | entità        |
| floor              | piano         |
| home / house       | casa          |
| integration        | integrazione  |
| package            | pacchetto     |
| room               | stanza        |
| scene              | scena         |
| setting            | impostazione  |
| sign in / sign out | accedi / esci |
| tag                | tag           |
| trigger            | attivazione   |
| vendor             | produttore    |

Address the reader informally (`tu`), as the English does ("your home" → "la tua casa").
