export const RACE_WORKFLOW_STATES = Object.freeze({
  SCHEDULED: 'scheduled',
  AWAITING_FINE_REVIEW: 'awaiting_fine_review',
  READY_TO_SCORE: 'ready_to_score',
  FINALIZED: 'finalized',
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [RACE_WORKFLOW_STATES.SCHEDULED]: [RACE_WORKFLOW_STATES.AWAITING_FINE_REVIEW, RACE_WORKFLOW_STATES.READY_TO_SCORE, RACE_WORKFLOW_STATES.FINALIZED],
  [RACE_WORKFLOW_STATES.AWAITING_FINE_REVIEW]: [RACE_WORKFLOW_STATES.READY_TO_SCORE, RACE_WORKFLOW_STATES.FINALIZED],
  [RACE_WORKFLOW_STATES.READY_TO_SCORE]: [RACE_WORKFLOW_STATES.FINALIZED],
  [RACE_WORKFLOW_STATES.FINALIZED]: [RACE_WORKFLOW_STATES.READY_TO_SCORE, RACE_WORKFLOW_STATES.FINALIZED],
});

export function mondayPublicationDate(raceDate) {
  const publication = new Date(`${raceDate}T12:00:00`);
  const currentDay = publication.getDay();
  const daysUntilMonday = ((8 - currentDay) % 7) || 1;
  publication.setDate(publication.getDate() + daysUntilMonday);
  publication.setHours(12, 0, 0, 0);
  return publication;
}

export function canTransitionRaceWorkflow(fromState, toState) {
  return Boolean(ALLOWED_TRANSITIONS[fromState]?.includes(toState));
}

export function evaluateRaceWorkflow({
  race,
  now = new Date(),
  fineReview,
  normalizedExists = false,
  scoredExists = false,
}) {
  if (normalizedExists && scoredExists) {
    return {
      state: RACE_WORKFLOW_STATES.FINALIZED,
      publicStatus: 'finalized',
      publicationAt: mondayPublicationDate(race.date),
      fineReviewComplete: Boolean(fineReview?.reviewed),
    };
  }

  const publicationAt = mondayPublicationDate(race.date);
  if (now < publicationAt) {
    return {
      state: RACE_WORKFLOW_STATES.SCHEDULED,
      publicStatus: 'not run',
      publicationAt,
      fineReviewComplete: Boolean(fineReview?.reviewed),
    };
  }

  const reviewed = Boolean(fineReview?.reviewed);
  return {
    state: reviewed ? RACE_WORKFLOW_STATES.READY_TO_SCORE : RACE_WORKFLOW_STATES.AWAITING_FINE_REVIEW,
    publicStatus: 'awaiting Monday scoring',
    publicationAt,
    fineReviewComplete: reviewed,
  };
}
