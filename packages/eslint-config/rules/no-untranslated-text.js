/**
 * `nebula/no-untranslated-text`: words written straight into JSX (RULES.md 1).
 *
 * Every string a person reads goes through `t('key', 'English')`, so the catalogue can translate
 * it and the English stays the fallback. This rule finds the ones that do not: text between tags,
 * a string in braces among the children - including either side of a `?:` and the right of a
 * `&&` - and a string given to an attribute that carries words (`label`, `title`, `aria-label`,
 * `placeholder`, anything ending in `Label`, `Title`, `Note`…).
 *
 * Only text with a letter in it counts: `–`, `…`, `×` and `42` are not words in any language.
 * What the rule cannot see - a sentence built in a helper, a table of labels - the translation
 * checker and review catch.
 *
 * Text that must stay as it is - a log level, a key's name, the product's name - is marked the way
 * HTML marks it for any translator: `translate="no"` on its element, which covers the element's
 * words and its attributes. An attribute of an element that cannot carry it (an SVG) takes an
 * `eslint-disable-next-line` and its reason.
 */

/** The attributes that carry words, by name. */
const TEXT_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-roledescription',
  'aria-valuetext',
  'caption',
  'description',
  'eyebrow',
  'heading',
  'help',
  'hint',
  'label',
  'legend',
  'message',
  'note',
  'placeholder',
  'subtitle',
  'summary',
  'term',
  'title',
  'tooltip',
  'warning',
]);

/** The attributes that carry words, by how their name ends: `closeLabel`, `loadingNote`. */
const TEXT_ATTRIBUTE_ENDINGS =
  /(?:Label|Title|Note|Hint|Message|Description|Heading|Caption|Placeholder|Text)$/;

/** Something a person reads: a letter in any script. */
const LETTER = /\p{L}/u;

/**
 * Says whether an attribute carries words.
 *
 * @param name - The attribute.
 * @param extra - Names the configuration added.
 * @returns True when its value is read.
 */
function isTextAttribute(name, extra) {
  return TEXT_ATTRIBUTES.has(name) || extra.has(name) || TEXT_ATTRIBUTE_ENDINGS.test(name);
}

/**
 * Says whether an element is marked as not to be translated: `translate="no"`.
 *
 * @param element - A JSX element.
 * @returns True when it is.
 */
function isMarkedVerbatim(element) {
  return (
    element?.type === 'JSXElement' &&
    element.openingElement.attributes.some(
      (attribute) =>
        attribute.type === 'JSXAttribute' &&
        attribute.name.name === 'translate' &&
        attribute.value?.type === 'Literal' &&
        attribute.value.value === 'no',
    )
  );
}

/**
 * Says whether a node is inside an element marked as not to be translated.
 *
 * @param node - The node.
 * @returns True when it, or an element around it, is marked.
 */
function isVerbatim(node) {
  for (
    let current = node.parent;
    current !== null && current !== undefined;
    current = current.parent
  ) {
    if (isMarkedVerbatim(current)) {
      return true;
    }
  }

  return false;
}

/**
 * Finds the literal strings an expression can evaluate to directly.
 *
 * @param node - The expression.
 * @returns The literals with a letter in them.
 */
function wordsIn(node) {
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string' && LETTER.test(node.value) ? [node] : [];
    case 'TemplateLiteral':
      return node.quasis.some((quasi) => LETTER.test(quasi.value.cooked ?? '')) ? [node] : [];
    case 'ConditionalExpression':
      return [...wordsIn(node.consequent), ...wordsIn(node.alternate)];
    case 'LogicalExpression':
      return wordsIn(node.right);
    default:
      return [];
  }
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow words in JSX that do not go through the translation catalogue' },
    schema: [
      {
        type: 'object',
        properties: { attributes: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      untranslated:
        "Say \"{{text}}\" through t('key', 'English') so it can be translated (RULES.md 1).",
    },
  },

  create(context) {
    const extra = new Set(context.options[0]?.attributes ?? []);

    /**
     * Reports one string.
     *
     * @param node - Where it is.
     * @param raw - What it says.
     */
    const report = (node, raw) => {
      const shown = raw.trim().replaceAll(/\s+/g, ' ');

      context.report({
        node,
        messageId: 'untranslated',
        data: { text: shown.length > 40 ? `${shown.slice(0, 39)}…` : shown },
      });
    };

    /**
     * Reports every literal an expression can be.
     *
     * @param expression - The expression.
     */
    const reportExpression = (expression) => {
      for (const literal of wordsIn(expression)) {
        report(literal, context.sourceCode.getText(literal).slice(1, -1));
      }
    };

    return {
      JSXText(node) {
        if (LETTER.test(node.value) && !isVerbatim(node)) {
          report(node, node.value);
        }
      },

      JSXExpressionContainer(node) {
        const parent = node.parent;

        if (
          (parent?.type === 'JSXElement' || parent?.type === 'JSXFragment') &&
          !isVerbatim(node)
        ) {
          reportExpression(node.expression);
        }
      },

      JSXAttribute(node) {
        const name =
          node.name.type === 'JSXNamespacedName'
            ? `${node.name.namespace.name}:${node.name.name.name}`
            : node.name.name;

        if (!isTextAttribute(name, extra) || node.value === null || isVerbatim(node)) {
          return;
        }

        if (node.value.type === 'Literal') {
          reportExpression(node.value);
        } else if (node.value.type === 'JSXExpressionContainer') {
          reportExpression(node.value.expression);
        }
      },
    };
  },
};
