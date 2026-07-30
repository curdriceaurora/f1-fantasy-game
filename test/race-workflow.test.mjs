import test from 'node:test';
import assert from 'node:assert/strict';
import { RACE_WORKFLOW_STATES, canTransitionRaceWorkflow, evaluateRaceWorkflow, isRaceScoreable, mondayPublicationDate, raceStatus } from '../lib/race-workflow.js';

const race = {
  id: 'australia',
  date: '2026-03-08',
};

test('race workflow stays scheduled before Monday publication', () => {
  const workflow = evaluateRaceWorkflow({
    race,
    now: new Date('2026-03-09T11:59:00Z'),
    fineReview: { reviewed: false, documents: [] },
  });

  assert.equal(workflow.state, RACE_WORKFLOW_STATES.SCHEDULED);
  assert.equal(workflow.publicStatus, 'not run');
  assert.equal(mondayPublicationDate(race.date).toISOString(), '2026-03-09T12:00:00.000Z');
});

test('race workflow waits on fine review after Monday cutoff', () => {
  const workflow = evaluateRaceWorkflow({
    race,
    now: new Date('2026-03-09T12:01:00Z'),
    fineReview: { reviewed: false, documents: [] },
  });

  assert.equal(workflow.state, RACE_WORKFLOW_STATES.AWAITING_FINE_REVIEW);
  assert.equal(workflow.publicStatus, 'awaiting fine review');
});

test('race workflow is ready to score once fine review is complete', () => {
  const workflow = evaluateRaceWorkflow({
    race,
    now: new Date('2026-03-09T12:01:00Z'),
    fineReview: { reviewed: true, documents: [] },
  });

  assert.equal(workflow.state, RACE_WORKFLOW_STATES.READY_TO_SCORE);
  assert.equal(workflow.publicStatus, 'awaiting Monday scoring');
});

test('race workflow reports finalized once normalized and scored artifacts exist', () => {
  const workflow = evaluateRaceWorkflow({
    race,
    now: new Date('2026-03-10T12:01:00Z'),
    fineReview: { reviewed: true, documents: [] },
    normalizedExists: true,
    scoredExists: true,
  });

  assert.equal(workflow.state, RACE_WORKFLOW_STATES.FINALIZED);
  assert.equal(workflow.publicStatus, 'finalized');
  assert.equal(canTransitionRaceWorkflow(RACE_WORKFLOW_STATES.READY_TO_SCORE, RACE_WORKFLOW_STATES.FINALIZED), true);
  assert.equal(canTransitionRaceWorkflow(RACE_WORKFLOW_STATES.SCHEDULED, RACE_WORKFLOW_STATES.AWAITING_FINE_REVIEW), true);
  assert.equal(canTransitionRaceWorkflow(RACE_WORKFLOW_STATES.AWAITING_FINE_REVIEW, RACE_WORKFLOW_STATES.SCHEDULED), false);
});

test('a cancelled race is never eligible for scoring', () => {
  const workflow = evaluateRaceWorkflow({
    race: { id: 'saudi-arabia', date: '2026-04-19', status: 'cancelled' },
    now: new Date('2026-07-30T12:00:00Z'),
    fineReview: { reviewed: false, documents: [] },
  });

  assert.equal(workflow.state, RACE_WORKFLOW_STATES.CANCELLED);
  assert.equal(workflow.publicStatus, 'cancelled');
  assert.equal(workflow.publicationAt, null);
});

test('a postponed race waits for a new date rather than reading as overdue', () => {
  const workflow = evaluateRaceWorkflow({
    race: { id: 'bahrain', date: '2026-04-12', status: 'postponed' },
    now: new Date('2026-07-30T12:00:00Z'),
    fineReview: { reviewed: false, documents: [] },
  });

  assert.equal(workflow.state, RACE_WORKFLOW_STATES.POSTPONED);
  assert.equal(workflow.publicStatus, 'postponed');
});

test('a rescheduled race is scored normally against its new date', () => {
  const race = { id: 'bahrain', date: '2026-10-04', status: 'rescheduled', originalDate: '2026-04-12' };
  assert.equal(isRaceScoreable(race), true);
  assert.equal(raceStatus(race), 'rescheduled');

  const beforeNewDate = evaluateRaceWorkflow({
    race,
    now: new Date('2026-07-30T12:00:00Z'),
    fineReview: { reviewed: false, documents: [] },
  });
  assert.equal(beforeNewDate.publicStatus, 'not run');

  const afterNewDate = evaluateRaceWorkflow({
    race,
    now: new Date('2026-10-05T13:00:00Z'),
    fineReview: { reviewed: false, documents: [] },
  });
  assert.equal(afterNewDate.state, RACE_WORKFLOW_STATES.AWAITING_FINE_REVIEW);
});

test('races default to scheduled when no status is recorded', () => {
  assert.equal(raceStatus({ id: 'monaco' }), 'scheduled');
  assert.equal(isRaceScoreable({ id: 'monaco' }), true);
  assert.equal(isRaceScoreable({ id: 'monaco', status: 'cancelled' }), false);
  assert.equal(isRaceScoreable({ id: 'monaco', status: 'postponed' }), false);
});
