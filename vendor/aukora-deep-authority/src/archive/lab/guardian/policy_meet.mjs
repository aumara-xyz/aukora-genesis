/**
 * DenyBiasedPolicyMeet:
 * Implements the Monotonic Policy Meet (⊕_deny).
 * Descendants can strictly narrow authority, never widen it:
 * - Allowed capabilities are INTERSECTED (A_child ⊆ A_parent).
 * - Denied capabilities are UNIONED (D_child ⊇ D_parent).
 * - Limits and budgets are MINIMIZED (B_child ≤ B_parent).
 */
export function denyBiasedPolicyMeet(parentPolicy = {}, childPolicy = {}) {
  const parentAllowed = new Set(parentPolicy.allowedTools || []);
  const childAllowed = new Set(childPolicy.allowedTools || []);

  // If parent specified allowedTools, child can only select a subset of parentAllowed
  let mergedAllowed = [];
  if (parentPolicy.allowedTools && childPolicy.allowedTools) {
    mergedAllowed = [...childAllowed].filter(t => parentAllowed.has(t));
  } else if (parentPolicy.allowedTools) {
    mergedAllowed = [...parentAllowed];
  } else if (childPolicy.allowedTools) {
    mergedAllowed = [...childAllowed];
  }

  // Denied tools are unioned (any ancestor denial is permanent)
  const parentDenied = new Set(parentPolicy.deniedTools || []);
  const childDenied = new Set(childPolicy.deniedTools || []);
  const mergedDenied = Array.from(new Set([...parentDenied, ...childDenied]));

  // Remove any denied tools from allowed list
  mergedAllowed = mergedAllowed.filter(t => !mergedDenied.includes(t));

  // Limits are minimized (tightened)
  const maxOperations = Math.min(
    parentPolicy.maxOperations !== undefined ? parentPolicy.maxOperations : Infinity,
    childPolicy.maxOperations !== undefined ? childPolicy.maxOperations : Infinity
  );

  const maxTtlMs = Math.min(
    parentPolicy.maxTtlMs !== undefined ? parentPolicy.maxTtlMs : Infinity,
    childPolicy.maxTtlMs !== undefined ? childPolicy.maxTtlMs : Infinity
  );

  return {
    allowedTools: mergedAllowed,
    deniedTools: mergedDenied,
    maxOperations: maxOperations === Infinity ? undefined : maxOperations,
    maxTtlMs: maxTtlMs === Infinity ? undefined : maxTtlMs
  };
}

export function isActionPermitted(policy, toolName) {
  if (policy.deniedTools && policy.deniedTools.includes(toolName)) {
    return false;
  }
  // An explicit allow-list — even an empty one — is the whole universe of
  // permission. An empty list is the deny-by-default meet (disjoint parents)
  // and must deny everything, not fall through to "permit all".
  if (policy.allowedTools) {
    return policy.allowedTools.includes(toolName);
  }
  return true;
}
