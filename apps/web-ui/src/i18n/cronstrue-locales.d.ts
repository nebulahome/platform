/**
 * cronstrue's per-language words ship as UMD files without declarations. Importing one registers
 * its language with cronstrue; nothing it exports is read.
 */
declare module 'cronstrue/locales/it' {
  const locale: unknown;

  // The UMD module's shape, as the bundler hands it over.
  // eslint-disable-next-line import-x/no-default-export -- see above
  export default locale;
}
