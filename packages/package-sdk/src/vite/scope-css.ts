/**
 * A package's stylesheet, kept to its own elements (PACKAGES_DOCS.md 6.2).
 *
 * The interface draws every page, card and view of a package inside an element marked
 * `data-nebula-package="<id>"`. Each rule of the package's stylesheet is rewritten to apply only
 * inside one: `.card` becomes `:where([data-nebula-package="weather"]) .card`, and a rule for the
 * document's root - `:root`, `html`, `body` - applies to the scope's root instead. `:where` adds no
 * specificity, so a rule weighs what its author wrote. Keyframes, fonts and registered properties
 * are names rather than selectors, and are left as they are.
 */
import postcss, { type ChildNode, type Container, type Document } from 'postcss';

/** A selector for the document's root, which becomes the scope's root. */
const DOCUMENT_ROOT = /^(?::root|html|body|:host)(?=$|[\s>+~:.[#])/;

/**
 * Says whether a rule is inside keyframes, where selectors are percentages.
 *
 * @param node - The rule.
 * @returns True when one of its parents is a `@keyframes`.
 */
function isInKeyframes(node: ChildNode): boolean {
  for (let parent: Container | Document | undefined = node.parent; parent !== undefined;) {
    if (parent.type === 'atrule' && 'name' in parent && String(parent.name).endsWith('keyframes')) {
      return true;
    }

    parent = 'parent' in parent ? (parent.parent ?? undefined) : undefined;
  }

  return false;
}

/**
 * Says whether a rule is nested in another rule, where its selector is relative to its parent's.
 *
 * @param node - The rule.
 * @returns True when its parent is a rule.
 */
function isNested(node: ChildNode): boolean {
  return node.parent?.type === 'rule';
}

/**
 * One selector, kept inside a scope.
 *
 * @param selector - The selector.
 * @param scope - The scope's selector.
 * @returns The selector inside it.
 */
function scoped(selector: string, scope: string): string {
  const trimmed = selector.trim();

  return DOCUMENT_ROOT.test(trimmed)
    ? trimmed.replace(DOCUMENT_ROOT, scope)
    : `${scope} ${trimmed}`;
}

/**
 * Rewrites a package's stylesheet to apply inside its own elements only.
 *
 * @param css - The stylesheet.
 * @param packageId - The package's id.
 * @returns The stylesheet, scoped.
 */
export function scopeCss(css: string, packageId: string): string {
  const root = postcss.parse(css);
  const scope = `:where([data-nebula-package="${packageId}"])`;

  root.walkRules((rule) => {
    if (isInKeyframes(rule) || isNested(rule)) {
      return;
    }

    rule.selectors = rule.selectors.map((selector) => scoped(selector, scope));
  });

  return root.toString();
}
