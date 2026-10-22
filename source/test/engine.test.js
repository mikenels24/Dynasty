const E = require('../src/engine.js');
const assert = require('assert');
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', name); }
const rec = (type, date, value, u = 1) => ({ type, date, value, updatedAt: u });

t('level curve matches blueprint', () => {
  assert.strictEqual(E.levelFromXp(99).level, 1);
  assert.strictEqual(E.levelFromXp(100).level, 2);
  assert.strictEqual(E.levelFromXp(1703).level, 5);
  assert.strictEqual(E.levelFromXp(11106).level, 10);
  assert.strictEqual(E.levelFromXp(67135).level, 20);
});
t('rating cost curve', () => {
  assert.strictEqual(E.ratingCost(60), 40);
  assert.strictEqual(E.ratingCost(80), 360);
  assert.strictEqual(E.ratingFromAp(39).rating, 60);
  assert.strictEqual(E.ratingFromAp(40).rating, 61);
});
t('full habit day in preseason', () => {
  const d = '2026-10-20';
  const r = E.compute([
    rec('water', d, 3), rec('steps', d, 9000), rec('walk', d, true),
    rec('vitamins', d, true), rec('journal', d, true), rec('read', d, { book: 'A', pct: 6 })
  ], d);
  assert.strictEqual(r.xp, 25 + 25 + 15 + 10 + 20 + 25);
  // DIS is focus: (3+3+2+2+3+3)*1.5 = 24
  assert.strictEqual(r.ratings.DIS.ap, 24);
  assert.strictEqual(r.ratings.FUE.ap, 6);   // 4 * 1.5
  assert.strictEqual(r.ratings.CON.ap, 7);   // not focus
  Object.keys(r.habits).forEach(h => assert.ok(r.habits[h].today, h));
});
t('duplicate records for same day count once (latest wins)', () => {
  const d = '2026-10-21';
  const r = E.compute([rec('walk', d, true, 1), rec('walk', d, true, 2), rec('water', d, 3, 1), rec('water', d, 1, 5)], d);
  assert.strictEqual(r.xp, 15);
});
t('water partial at 2 bottles, nothing at 1', () => {
  assert.strictEqual(E.compute([rec('water', '2026-10-21', 2)], '2026-10-21').xp, 10);
  assert.strictEqual(E.compute([rec('water', '2026-10-21', 1)], '2026-10-21').xp, 0);
});
t('steps under goal earn nothing', () => {
  assert.strictEqual(E.compute([rec('steps', '2026-10-21', 7999)], '2026-10-21').xp, 0);
});
t('reading uses daily delta of Kindle %', () => {
  const r = E.compute([
    rec('read', '2026-10-20', { book: 'A', pct: 10 }),
    rec('read', '2026-10-21', { book: 'A', pct: 14 }),
    rec('read', '2026-10-22', { book: 'A', pct: 30 }),
  ], '2026-10-22');
  // day1 delta 10 -> 25 + extra 5; day2 delta 4 -> 0; day3 delta 16 -> 25 + 10
  assert.strictEqual(r.xp, 30 + 0 + 35);
  assert.ok(!r.habits.read.week.find(x => x.date === '2026-10-21').done);
});
t('extra reading capped at +15', () => {
  assert.strictEqual(E.compute([rec('read', '2026-10-20', { book: 'A', pct: 60 })], '2026-10-20').xp, 25 + 15);
});
t('finishing a book pays once', () => {
  const r = E.compute([
    rec('read', '2026-10-20', { book: 'A', pct: 96 }),
    rec('read', '2026-10-21', { book: 'A', pct: 100 }),
    rec('read', '2026-10-22', { book: 'A', pct: 100 }),
  ], '2026-10-22');
  // day1: new book, delta 96 -> 25+15 ; day2: delta 4 -> 0 + finish 150 ; day3: nothing
  assert.strictEqual(r.xp, 40 + 150);
});
t('new book resets the baseline', () => {
  const r = E.compute([
    rec('read', '2026-10-20', { book: 'A', pct: 100 }),
    rec('read', '2026-10-21', { book: 'B', pct: 5 }),
  ], '2026-10-21');
  assert.strictEqual(r.byDay['2026-10-21'].xp, 25);
});
t('future-dated records are ignored', () => {
  assert.strictEqual(E.compute([rec('walk', '2026-10-25', true)], '2026-10-21').xp, 0);
});
t('season labels', () => {
  assert.strictEqual(E.seasonFor('2026-10-20').label, 'Preseason');
  assert.strictEqual(E.seasonFor('2026-10-26').week, 1);
  assert.strictEqual(E.seasonFor('2027-01-17').week, 12);
  assert.strictEqual(E.seasonFor('2027-01-18').label, 'Offseason');
});
t('week streak: 5 of 7 keeps it alive, one miss day is fine', () => {
  const recs = [];
  // Week of Oct 26 - Nov 1: walk 5 days. Week of Nov 2: walk 6 days. Week of Nov 9 (current): 2 days so far.
  ['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'].forEach(d => recs.push(rec('walk', d, true)));
  ['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07'].forEach(d => recs.push(rec('walk', d, true)));
  ['2026-11-09','2026-11-10'].forEach(d => recs.push(rec('walk', d, true)));
  const r = E.compute(recs, '2026-11-10');
  assert.strictEqual(r.habits.walk.streak, 2);
  assert.strictEqual(r.habits.walk.weekCount, 2);
});
t('week streak resets after a 4-day week, best is kept', () => {
  const recs = [];
  ['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'].forEach(d => recs.push(rec('walk', d, true)));
  ['2026-11-02','2026-11-03','2026-11-04','2026-11-05'].forEach(d => recs.push(rec('walk', d, true)));
  const r = E.compute(recs, '2026-11-10');
  assert.strictEqual(r.habits.walk.streak, 0);
  assert.strictEqual(r.habits.walk.best, 1);
});
t('realistic season projection lands near blueprint', () => {
  const recs = [];
  for (let i = 0; i < 84; i++) {
    const d = E.addDays('2026-10-26', i);
    if (i % 7 !== 6) { ['walk','vitamins','journal'].forEach(h => recs.push(rec(h, d, true))); recs.push(rec('water', d, 3)); recs.push(rec('steps', d, 8500)); }
    recs.push(rec('read', d, { book: 'B' + Math.floor(i / 20), pct: (i % 20) * 5 + 5 }));
  }
  const r = E.compute(recs, '2027-01-17');
  console.log('   season sim: level', r.level, 'xp', r.xp, 'DIS', r.ratings.DIS.rating, 'MND', r.ratings.MND.rating, 'OVR', r.ovr);
  assert.ok(r.level >= 7 && r.level <= 11);
});

// ---------- Stage 2 ----------
t('checklist items score once per day', () => {
  const d = '2026-10-21';
  const r = E.compute([rec('workout', d, true), rec('macros', d, true), rec('cardio', d, true), rec('sleep', d, 7.5)], d);
  assert.strictEqual(r.byDay[d].awards.filter(a => !/^Quest/.test(a.label)).reduce((s, a) => s + a.xp, 0), 60 + 40 + 40 + 30);
  assert.strictEqual(r.lastWorkout, d);
});
t('sleep tiers', () => {
  const x = h => E.compute([rec('sleep', '2026-10-21', h)], '2026-10-21').byDay['2026-10-21'];
  const nq = a => a.awards.filter(w => !/^Quest/.test(w.label)).reduce((s, w) => s + w.xp, 0); assert.strictEqual(nq(x(6.5)), 10); assert.strictEqual(nq(x(8)), 30); assert.strictEqual(nq(x(10)), 10); assert.ok(!x(5));
});
const mrec = (type, date, value, id) => ({ type, date, value, key: type + ':' + date + ':' + id, createdAt: id, updatedAt: id });
t('bonds caps: one call a day, two date nights a week', () => {
  const r = E.compute([
    mrec('bonds', '2026-10-21', { kind: 'call' }, 1), mrec('bonds', '2026-10-21', { kind: 'call' }, 2),
    mrec('bonds', '2026-10-21', { kind: 'date' }, 3), mrec('bonds', '2026-10-22', { kind: 'date' }, 4), mrec('bonds', '2026-10-23', { kind: 'date' }, 5),
  ], '2026-10-23');
  assert.strictEqual(r.xp, 25 + 50 + 50 + 100); // + preseason Bonds quest
});
t('echo chapters: duplicates and 4th in a day earn nothing', () => {
  const r = E.compute([1, 2, 2, 3, 4].map((c, i) => mrec('echo', '2026-10-28', { chapter: c }, i + 1)), '2026-10-28');
  assert.strictEqual(r.questLines.manuscript.done, 3);
  assert.deepStrictEqual(r.questLines.manuscript.chapters, [1, 2, 3]);
});
t('career tiers and Director Run', () => {
  const r = E.compute([mrec('career', '2026-10-28', { title: 'Applied to Acme', tier: 1, director: true }, 1), mrec('career', '2026-10-28', { title: 'Offer', tier: 3 }, 2)], '2026-10-28');
  assert.strictEqual(r.byDay['2026-10-28'].awards.filter(a => /win/.test(a.label)).reduce((s, a) => s + a.xp, 0), 350);
  assert.strictEqual(r.questLines.director.wins.length, 1);
});
t('wealth: one check-in a month, milestones once', () => {
  const r = E.compute([
    mrec('wealth', '2026-11-01', { balance: 81000 }, 1), mrec('wealth', '2026-11-20', { balance: 86000 }, 2),
    mrec('wealth', '2026-12-01', { balance: 84000 }, 3), mrec('wealth', '2026-12-15', { balance: 86500 }, 4)
  ], '2026-12-15');
  const labels = Object.values(r.byDay).flatMap(d => d.awards).map(a => a.label).filter(l => /Wealth|milestone/.test(l));
  assert.deepStrictEqual(labels, ['Wealth check-in', '$80K milestone', '$85K milestone', 'Wealth check-in']);
  assert.strictEqual(r.questLines.wealth.latest.balance, 86500);
});
t('preseason quests and Perfect Preseason', () => {
  const recs = [];
  ['2026-10-20', '2026-10-21'].forEach(d => { E.HABITS.forEach(h => recs.push(rec(h, d, h === 'water' ? 3 : h === 'steps' ? 9000 : h === 'read' ? { book: 'A', pct: d === '2026-10-20' ? 5 : 10 } : true))); recs.push(rec('macros', d, true)); recs.push(rec('sleep', d, 8)); });
  recs.push(rec('sleep', '2026-10-22', 8)); recs.push(rec('workout', '2026-10-22', true)); recs.push(mrec('bonds', '2026-10-22', { kind: 'call' }, 9));
  const r = E.compute(recs, '2026-10-22', { firstBackupOn: '2026-10-21' });
  assert.ok(r.week.isPre);
  assert.ok(r.week.quests.every(q => q.done), JSON.stringify(r.week.quests.map(q => [q.id, q.progress])));
  assert.strictEqual(r.week.perfect.doneOn, '2026-10-22');
});
t('season weeks: 6 quests, 4 focus + 2 rotating, rotation changes', () => {
  const r1 = E.compute([], '2026-10-27'), r2 = E.compute([], '2026-11-03');
  [r1, r2].forEach(r => { assert.strictEqual(r.week.quests.length, 6); assert.strictEqual(r.week.quests.filter(q => q.focus).length, 4); });
  const rot = r => r.week.quests.filter(q => !q.focus).map(q => q.attr).join();
  assert.notStrictEqual(rot(r1), rot(r2));
  console.log('   wk1', r1.week.quests.map(q => q.attr + ':' + q.title).join(' | '));
  console.log('   wk2', r2.week.quests.map(q => q.attr + ':' + q.title).join(' | '));
});
t('quest XP lands on the day the quest completes', () => {
  const recs = ['2026-10-26', '2026-10-27', '2026-10-28'].map(d => rec('workout', d, true));
  const r = E.compute(recs, '2026-10-30');
  assert.ok(r.byDay['2026-10-28'].awards.some(a => a.label === 'Quest: Lift 3 times'));
});
console.log(n + ' tests passed');
