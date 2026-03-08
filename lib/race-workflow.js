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

function parseRaceDateUtc(raceDate) {
  const [yearStr, monthStr, dayStr] = String(raceDate).split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const day = Number(dayStr);
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) {
    throw new Error(`Invalid race date "${raceDate}"`);
  }
  return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0, 0));
}

export function mondayPublicationDate(raceDate) {
  const publication = parseRaceDateUtc(raceDate);
  const currentDay = publication.getUTCDay();
  const daysUntilMonday = ((8 - currentDay) % 7) || 1;
  publication.setUTCDate(publication.getUTCDate() + daysUntilMonday);
  publication.setUTCHours(12, 0, 0, 0);
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
    publicStatus: reviewed ? 'awaiting Monday scoring' : 'awaiting fine review',
    publicationAt,
    fineReviewComplete: reviewed,
  };
}
