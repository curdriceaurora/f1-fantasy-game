export const RACE_WORKFLOW_STATES = Object.freeze({
  SCHEDULED: 'scheduled',
  AWAITING_FINE_REVIEW: 'awaiting_fine_review',
  READY_TO_SCORE: 'ready_to_score',
  FINALIZED: 'finalized',
  POSTPONED: 'postponed',
  CANCELLED: 'cancelled',
});

// A calendar entry is a plan, not a promise: races get postponed, cancelled, or
// run months later at another circuit under the same name. `status` records
// which of those happened; `date` always means the date the race is actually
// expected to run, so a rescheduled race stays scoreable on its new date.
export const RACE_STATUSES = Object.freeze({
  SCHEDULED: 'scheduled',
  RESCHEDULED: 'rescheduled',
  POSTPONED: 'postponed',
  CANCELLED: 'cancelled',
});

const SCOREABLE_STATUSES = new Set([RACE_STATUSES.SCHEDULED, RACE_STATUSES.RESCHEDULED]);

export function raceStatus(race) {
  return race?.status || RACE_STATUSES.SCHEDULED;
}

// Postponed races have no date to score against and cancelled ones never ran,
// so neither is ever eligible — they are not failures to retry.
export function isRaceScoreable(race) {
  return SCOREABLE_STATUSES.has(raceStatus(race));
}

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
  if (!isRaceScoreable(race)) {
    const cancelled = raceStatus(race) === RACE_STATUSES.CANCELLED;
    return {
      state: cancelled ? RACE_WORKFLOW_STATES.CANCELLED : RACE_WORKFLOW_STATES.POSTPONED,
      publicStatus: cancelled ? 'cancelled' : 'postponed',
      publicationAt: null,
      fineReviewComplete: false,
    };
  }

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
