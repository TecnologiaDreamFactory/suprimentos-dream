/**
 * Workflow de decisão humana para lotes (compare-batch).
 */

const DECISION_STATUS = {
  PROCESSED: "processed",
  REVIEW_REQUIRED: "review_required",
  APPROVED: "approved",
  REJECTED: "rejected",
};

/**
 * @param {boolean} manualReviewRequired
 * @returns {typeof DECISION_STATUS[keyof typeof DECISION_STATUS]}
 */
function deriveInitialDecisionStatus(manualReviewRequired) {
  return manualReviewRequired ? DECISION_STATUS.REVIEW_REQUIRED : DECISION_STATUS.PROCESSED;
}

/**
 * @param {string} current
 * @param {"approved"|"rejected"} next
 * @returns {{ ok: boolean, message?: string }}
 */
function canTransitionToManualDecision(current, next) {
  if (next !== "approved" && next !== "rejected") {
    return { ok: false, message: "status deve ser approved ou rejected" };
  }
  if (current === DECISION_STATUS.APPROVED || current === DECISION_STATUS.REJECTED) {
    return { ok: false, message: "Lote já possui decisão final (approved/rejected)." };
  }
  return { ok: true };
}

module.exports = {
  DECISION_STATUS,
  deriveInitialDecisionStatus,
  canTransitionToManualDecision,
};
