// @ts-check
/**
 * budget.js — Counting components before Discord does.
 *
 * A Components V2 message is capped at 40 components in total, nested ones
 * included, and 10 at the top level. discord.js enforces none of that: an
 * over-budget container serialises without complaint and comes back as a bare
 * `Invalid Form Body` 400, which in a refresh path is easy to mistake for "the
 * panel just didn't update". So the panel counts its own tree and fails with a
 * message that says what actually happened.
 *
 * The numbers are Discord's, documented at
 * https://discord.com/developers/docs/components/overview
 */

const MAX_COMPONENTS = 40;
const MAX_TOP_LEVEL = 10;

/**
 * Every component in a tree, counting the node itself, its `components`, and a
 * section's `accessory` (which is a component too, and easy to forget).
 * @param {*} node  a builder or its JSON
 * @returns {number}
 */
function countComponents(node) {
  if (!node) return 0;
  const json = typeof node.toJSON === 'function' ? node.toJSON() : node;
  if (Array.isArray(json)) return json.reduce((sum, child) => sum + countComponents(child), 0);

  let total = 1;
  if (Array.isArray(json.components)) total += countComponents(json.components);
  if (json.accessory) total += countComponents(json.accessory);
  return total;
}

/**
 * Throws when a payload's components cannot be sent.
 * @param {*} components  the top-level component list
 * @returns {number} the total, so callers can log it
 */
function assertBudget(components) {
  const list = Array.isArray(components) ? components : [components];
  const total = countComponents(list);

  if (total > MAX_COMPONENTS) {
    throw new Error(
      `Panel uses ${total} components; Discord allows ${MAX_COMPONENTS}. ` +
      'Promote a section to a plain text line, or move an action into a dropdown.'
    );
  }
  if (list.length > MAX_TOP_LEVEL) {
    throw new Error(`Panel has ${list.length} top-level components; Discord allows ${MAX_TOP_LEVEL}.`);
  }
  return total;
}

module.exports = { MAX_COMPONENTS, MAX_TOP_LEVEL, countComponents, assertBudget };
