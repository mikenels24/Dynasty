/* Dynasty scoring engine.
   Pure functions: XP, levels, ratings, quests and streaks are computed from the saved
   records every time, never stored. Editing or deleting a record recalculates everything,
   and each record has one key, so a double tap can never pay twice. */
(function (root) {
  'use strict';

  var ATTRS = ['STR', 'CON', 'FUE', 'REC', 'DIS', 'MND', 'CRA', 'CAR', 'WEA', 'BON'];
  var ATTR_NAMES = {
    STR: 'Strength', CON: 'Conditioning', FUE: 'Fuel', REC: 'Recovery', DIS: 'Discipline',
    MND: 'Mind', CRA: 'Craft', CAR: 'Career', WEA: 'Wealth', BON: 'Bonds'
  };
  var START_RATING = 60;
  var FOCUS_MULT = 1.5;
  var WATER_BOTTLE_OZ = 40;
  var WATER_GOAL_BOTTLES = 3;
  var STEPS_GOAL = 8000;
  var READ_GOAL_PCT = 5;
  var HABITS = ['water', 'steps', 'read', 'walk', 'vitamins', 'journal'];
  var CAREER_TIERS = [
    { name: 'Small', xp: 20, ap: 3 }, { name: 'Medium', xp: 50, ap: 6 },
    { name: 'Big', xp: 100, ap: 12 }, { name: 'Major', xp: 300, ap: 30 }
  ];
  var WEALTH_START = 79000;
  var WEALTH_MILESTONES = [{ amt: 80000, xp: 200, ap: 15 }, { amt: 85000, xp: 300, ap: 20 }, { amt: 90000, xp: 500, ap: 30 }];
  var ECHO_CHAPTERS = 33;
  var QUEST_XP = 100, QUEST_AP = 6, PERFECT_XP = 200;
  var QUEST_EPOCH = '2026-10-19';  // Monday of preseason week
  var KICKOFF = '2026-10-26';

  var TITLES = [
    { level: 1, title: 'Walk-On' }, { level: 5, title: 'Starter' }, { level: 10, title: 'Team Captain' },
    { level: 20, title: 'All-Conference' }, { level: 30, title: 'All-American' }, { level: 50, title: 'Hall of Famer' }
  ];
  var SEASONS = [
    { id: 'pre', label: 'Preseason', start: '2026-10-20', end: '2026-10-25', focus: ['FUE', 'DIS', 'STR'] },
    { id: 's1', label: 'Season 1', start: '2026-10-26', end: '2027-01-17', focus: ['FUE', 'DIS', 'STR'] }
  ];

  /* ---------- dates (local calendar days as YYYY-MM-DD strings) ---------- */
  function dayNum(d) { return Math.round(Date.parse(d + 'T00:00:00Z') / 864e5); }
  function fromNum(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }
  function addDays(d, k) { return fromNum(dayNum(d) + k); }
  function weekStart(d) { var n = dayNum(d); var dow = (new Date(n * 864e5).getUTCDay() + 6) % 7; return fromNum(n - dow); }
  function localToday(now) {
    now = now || new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }

  /* ---------- curves ---------- */
  function xpToNext(level) { return Math.round(100 * Math.pow(level, 1.5)); }
  function levelFromXp(xp) {
    var level = 1, need = xpToNext(1), into = xp;
    while (into >= need) { into -= need; level += 1; need = xpToNext(level); }
    return { level: level, into: into, need: need };
  }
  function titleFor(level) { var t = TITLES[0].title; TITLES.forEach(function (x) { if (level >= x.level) t = x.title; }); return t; }
  function nextTitle(level) { for (var i = 0; i < TITLES.length; i++) if (TITLES[i].level > level) return TITLES[i]; return null; }
  function ratingCost(r) { return Math.round(0.4 * Math.pow(r - 50, 2)); }
  function ratingFromAp(ap) {
    var r = START_RATING, bank = ap;
    while (r < 99 && bank >= ratingCost(r)) { bank -= ratingCost(r); r += 1; }
    return { rating: r, into: bank, need: r < 99 ? ratingCost(r) : 0 };
  }

  function seasonFor(date) {
    for (var i = 0; i < SEASONS.length; i++) {
      var s = SEASONS[i];
      if (date >= s.start && date <= s.end) {
        var day = dayNum(date) - dayNum(s.start), total = dayNum(s.end) - dayNum(s.start) + 1;
        return { id: s.id, label: s.label, focus: s.focus, start: s.start, end: s.end, day: day + 1, totalDays: total, week: Math.floor(day / 7) + 1, weeks: Math.ceil(total / 7) };
      }
    }
    var last = SEASONS[SEASONS.length - 1];
    var first = SEASONS[0];
    return { id: 'off', label: 'Offseason', focus: (date < first.start ? first : last).focus, start: last.end, end: last.end, day: 0, totalDays: 0, week: 0, weeks: 0 };
  }


  /* ---------- reading ---------- */
  function readingDeltas(records) {
    var reads = records.filter(function (r) { return r.type === 'read'; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var out = {}, prev = null;
    reads.forEach(function (r) {
      var v = r.value || {};
      var pct = Math.max(0, Math.min(100, Number(v.pct) || 0));
      var sameBook = prev && prev.book === v.book && !v.newBook;
      var delta = Math.max(0, pct - (sameBook ? prev.pct : 0));
      out[r.date] = { delta: delta, pct: pct, book: v.book, finished: pct >= 100 && (!sameBook || prev.pct < 100) };
      prev = { book: v.book, pct: pct };
    });
    return out;
  }

  /* ---------- quests ---------- */
  function cnt(k) { return function (days) { var n = 0; days.forEach(function (d) { if (d[k]) n++; }); return n; }; }
  function sum(k) { return function (days) { var n = 0; days.forEach(function (d) { n += d[k] || 0; }); return n; }; }
  function Q(id, title, fn, target, unit) { return { id: id, title: title, fn: fn, target: target, unit: unit || '' }; }
  var POOL = {
    STR: [Q('str-lift3', 'Lift 3 times', cnt('workout'), 3), Q('str-pair', 'Lift and do cardio on the same day, twice', function (days) { var n = 0; days.forEach(function (d) { if (d.workout && d.cardio) n++; }); return n; }, 2)],
    FUE: [Q('fue-macros5', 'Hit your macros on 5 days', cnt('macro'), 5), Q('fue-water5', 'Hit the water goal on 5 days', cnt('water'), 5)],
    DIS: [Q('dis-all3', 'Clear all 6 habits on 3 days', cnt('allHabits'), 3), Q('dis-journal5', 'Journal on 5 days', cnt('journal'), 5)],
    CON: [Q('con-steps5', '8,000 steps on 5 days', cnt('steps'), 5), Q('con-cardio2', 'Two cardio sessions', cnt('cardio'), 2)],
    REC: [Q('rec-sleep5', 'Sleep 7+ hours on 5 nights', cnt('sleepOk'), 5), Q('rec-vit6', 'Vitamins on 6 days', cnt('vitamins'), 6)],
    MND: [Q('mnd-read30', 'Read 30% of a book', sum('readDelta'), 30, '%'), Q('mnd-read5', 'Read 5%+ on 5 days', cnt('read'), 5)],
    CRA: [Q('cra-echo2', 'Format 2 Echo chapters', sum('echo'), 2), Q('cra-echo4', 'Format 4 Echo chapters', sum('echo'), 4)],
    CAR: [Q('car-wins2', 'Log 2 career wins', sum('career'), 2), Q('car-big', 'Land a Big career win', sum('careerBig'), 1)],
    WEA: [Q('wea-check', 'Do your monthly wealth check-in', sum('wealth'), 1)],
    BON: [Q('bon-date', 'Have a date night', sum('dates'), 1), Q('bon-call2', 'Call 2 friends or family', sum('calls'), 2), Q('bon-plans', 'Make plans with friends', sum('plans'), 1)]
  };
  var PRESEASON = [
    { id: 'pre-macros', title: 'Hit your macros on 2 days', attr: 'FUE', target: 2, fn: cnt('macro') },
    { id: 'pre-bonds', title: 'Log a Bonds moment', attr: 'BON', target: 1, fn: function (days) { var n = 0; days.forEach(function (d) { n += (d.dates || 0) + (d.calls || 0) + (d.plans || 0); }); return n; } },
    { id: 'pre-workout', title: 'Log your first workout', attr: 'STR', target: 1, fn: cnt('workout') },
    { id: 'pre-sleep', title: 'Log sleep on 3 nights', attr: 'REC', target: 3, fn: cnt('sleepLogged') },
    { id: 'pre-habits', title: 'Clear all 6 habits on 2 days', attr: 'DIS', target: 2, fn: cnt('allHabits') },
    { id: 'pre-backup', title: 'Make your first backup', attr: 'DIS', target: 1, ctxKey: 'firstBackupOn' }
  ];
  function withAttr(q, a, focus) { return { id: q.id, title: q.title, fn: q.fn, target: q.target, unit: q.unit, attr: a, focus: !!focus }; }
  function weekIndex(ws) { return Math.round((dayNum(ws) - dayNum(QUEST_EPOCH)) / 7); }

  // 4 quests for the season's focus attributes + 2 that rotate through the other attributes.
  function questsForWeek(ws, wealthDoneBefore) {
    if (ws < KICKOFF) return PRESEASON.map(function (q) { var c = {}; for (var k in q) c[k] = q[k]; c.focus = true; return c; });
    var w = weekIndex(ws), focus = seasonFor(addDays(ws, 6)).focus, out = [], seen = {};
    var push = function (q, a, f) { if (!seen[q.id]) { seen[q.id] = 1; out.push(withAttr(q, a, f)); return true; } return false; };
    focus.forEach(function (a) { push(POOL[a][0], a, true); });
    for (var i = 0; i < focus.length && out.length < 4; i++) {
      var a4 = focus[(w + i) % focus.length], p = POOL[a4];
      for (var j = 1; j <= p.length && out.length < 4; j++) push(p[(w + j) % p.length], a4, true);
    }
    var others = ATTRS.filter(function (a) { return focus.indexOf(a) < 0; });
    var monthDone = wealthDoneBefore(ws);
    for (var k = 0; k < others.length * 2 && out.length < 6; k++) {
      var a = others[(2 * w + k) % others.length];
      if (a === 'WEA' && monthDone) continue;
      if (out.some(function (q) { return q.attr === a; })) continue;
      push(POOL[a][w % POOL[a].length], a, false);
    }
    return out;
  }

  function evalWeek(ws, today, facts, ctx, wealthDoneBefore) {
    var qs = questsForWeek(ws, wealthDoneBefore);
    var days = [];
    for (var i = 0; i < 7; i++) { var d = addDays(ws, i); if (d > today) break; days.push(facts[d] || {}); }
    var preEnd = addDays(KICKOFF, -1);
    qs.forEach(function (q) {
      q.doneOn = null;
      if (q.ctxKey) {
        var on = ctx[q.ctxKey];
        var ok = on && on <= preEnd && on <= today;
        q.progress = ok ? 1 : 0;
        if (ok) q.doneOn = on < ws ? ws : on;
      } else {
        q.progress = q.fn(days);
        for (var j = 0; j < days.length; j++) if (q.fn(days.slice(0, j + 1)) >= q.target) { q.doneOn = addDays(ws, j); break; }
      }
      q.done = !!q.doneOn;
      delete q.fn;
    });
    var all = qs.length > 0 && qs.every(function (q) { return q.done; });
    var perfectOn = all ? qs.reduce(function (m, q) { return q.doneOn > m ? q.doneOn : m; }, ws) : null;
    return { ws: ws, isPre: ws < KICKOFF, quests: qs, perfect: { done: all, doneOn: perfectOn } };
  }

  function award(xp, ap, label) { return { xp: xp, ap: ap, label: label }; }

  /* ---------- full compute ---------- */
  // ctx: { firstBackupOn }
  function compute(records, today, ctx) {
    today = today || localToday();
    ctx = ctx || {};
    var latest = {};
    records.forEach(function (r) {
      var k = r.key || (r.type + ':' + r.date);
      if (!latest[k] || (r.updatedAt || 0) >= (latest[k].updatedAt || 0)) latest[k] = r;
    });
    var recs = Object.keys(latest).map(function (k) { return latest[k]; })
      .filter(function (r) { return r.date <= today; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : ((a.createdAt || a.updatedAt || 0) - (b.createdAt || b.updatedAt || 0)); });
    var readInfo = readingDeltas(recs);

    var xp = 0, ap = {}, byDay = {}, facts = {};
    ATTRS.forEach(function (k) { ap[k] = 0; });
    function F(d) { return facts[d] || (facts[d] = {}); }
    function give(date, aw) {
      var focus = seasonFor(date).focus;
      xp += aw.xp;
      var day = byDay[date] || (byDay[date] = { xp: 0, awards: [] });
      day.xp += aw.xp; day.awards.push(aw);
      Object.keys(aw.ap).forEach(function (k) { ap[k] += aw.ap[k] * (focus.indexOf(k) >= 0 ? FOCUS_MULT : 1); });
    }

    var echoDone = {}, echoDay = {}, callDay = {}, bondsWeek = {};
    var wealthMonths = {}, wealthCheckins = [], wealthHit = {}, wealthLatest = null, directorWins = [];
    var lastWorkout = null;

    recs.forEach(function (r) {
      var v = r.value, d = r.date, f;
      switch (r.type) {
        case 'water':
          if (v >= WATER_GOAL_BOTTLES) { give(d, award(25, { FUE: 4, DIS: 3 }, 'Water goal')); F(d).water = true; }
          else if (v >= 2) give(d, award(10, { FUE: 2 }, 'Water, 2 bottles'));
          break;
        case 'steps':
          if (v >= STEPS_GOAL) { give(d, award(25, { CON: 4, DIS: 3 }, Number(v).toLocaleString('en-US') + ' steps')); F(d).steps = true; }
          break;
        case 'walk': if (v) { give(d, award(15, { CON: 3, DIS: 2 }, 'Daily walk')); F(d).walk = true; } break;
        case 'vitamins': if (v) { give(d, award(10, { REC: 2, DIS: 2 }, 'Vitamins')); F(d).vitamins = true; } break;
        case 'journal': if (v) { give(d, award(20, { MND: 3, DIS: 3 }, 'Journal')); F(d).journal = true; } break;
        case 'read':
          var info = readInfo[d];
          if (info) {
            F(d).readDelta = info.delta;
            if (info.delta >= READ_GOAL_PCT) {
              F(d).read = true;
              give(d, award(25, { MND: 5, DIS: 3 }, 'Read ' + info.delta + '%'));
              var extra = Math.min(3, Math.floor((info.delta - READ_GOAL_PCT) / 5));
              if (extra > 0) give(d, award(5 * extra, {}, 'Extra reading'));
            }
            if (info.finished) give(d, award(150, { MND: 15 }, 'Finished a book'));
          }
          break;
        case 'workout':
          if (v) { give(d, award(60, { STR: 10 }, 'Workout')); F(d).workout = true; lastWorkout = d; }
          break;
        case 'macros':
          if (v) { give(d, award(40, { FUE: 8 }, 'Macros on target')); F(d).macro = true; }
          break;
        case 'cardio':
          if (v) { give(d, award(40, { CON: 8 }, 'Cardio')); F(d).cardio = true; }
          break;
        case 'sleep':
          var h = Number(v);
          if (!(h > 0)) break;
          F(d).sleepLogged = true;
          if (h >= 7 && h <= 9) { give(d, award(30, { REC: 8 }, 'Slept ' + h + ' h')); F(d).sleepOk = true; }
          else if (h >= 6) give(d, award(10, { REC: 3 }, 'Slept ' + h + ' h'));
          break;
        case 'bonds':
          if (!v) break;
          var ws = weekStart(d), bw = bondsWeek[ws] || (bondsWeek[ws] = { date: 0, plans: 0 });
          if (v.kind === 'call') {
            if (!callDay[d]) { callDay[d] = 1; give(d, award(25, { BON: 4 }, 'Called ' + (v.note || 'friend or family'))); F(d).calls = (F(d).calls || 0) + 1; }
          } else if (v.kind === 'date' && bw.date < 2) {
            bw.date++; give(d, award(50, { BON: 8 }, 'Date night')); F(d).dates = (F(d).dates || 0) + 1;
          } else if (v.kind === 'plans' && bw.plans < 2) {
            bw.plans++; give(d, award(50, { BON: 8 }, 'Plans with friends')); F(d).plans = (F(d).plans || 0) + 1;
          }
          break;
        case 'echo':
          var ch = Number(v && v.chapter);
          if (!(ch >= 1 && ch <= ECHO_CHAPTERS) || echoDone[ch]) break;
          echoDay[d] = echoDay[d] || 0;
          if (echoDay[d] >= 3) break;
          echoDay[d]++; echoDone[ch] = d;
          give(d, award(50, { CRA: 10 }, 'Echo chapter ' + ch + ' formatted'));
          F(d).echo = (F(d).echo || 0) + 1;
          break;
        case 'career':
          var tier = CAREER_TIERS[v && v.tier];
          if (!tier) break;
          give(d, award(tier.xp, { CAR: tier.ap }, tier.name + ' win: ' + (v.title || 'Career')));
          f = F(d); f.career = (f.career || 0) + 1; if (v.tier >= 2) f.careerBig = (f.careerBig || 0) + 1;
          if (v.director) directorWins.push({ date: d, title: v.title, tier: tier.name });
          break;
        case 'wealth':
          var bal = Number(v && v.balance);
          if (!(bal > 0)) break;
          var m = d.slice(0, 7);
          if (!wealthMonths[m]) { wealthMonths[m] = d; wealthCheckins.push(d); give(d, award(30, { WEA: 5 }, 'Wealth check-in')); F(d).wealth = 1; }
          WEALTH_MILESTONES.forEach(function (ms) {
            if (bal >= ms.amt && !wealthHit[ms.amt]) { wealthHit[ms.amt] = d; give(d, award(ms.xp, { WEA: ms.ap }, '$' + (ms.amt / 1000) + 'K milestone')); }
          });
          wealthLatest = { balance: bal, date: d };
          break;
      }
    });

    // Habit completion per day
    Object.keys(facts).forEach(function (d) {
      var f = facts[d];
      f.allHabits = HABITS.every(function (h) { return f[h]; });
    });

    // Weekly quests, from preseason week through this week
    var weeks = [], wealthDoneBefore = function (ws) { var m = ws.slice(0, 7); return wealthCheckins.some(function (d) { return d < ws && d.slice(0, 7) === m; }); };
    var curWs = weekStart(today);
    if (today >= QUEST_EPOCH) {
      for (var ws2 = QUEST_EPOCH; ws2 <= curWs; ws2 = addDays(ws2, 7)) {
        var wk = evalWeek(ws2, today, facts, ctx, wealthDoneBefore);
        wk.quests.forEach(function (q) { if (q.done) { var a = {}; a[q.attr] = QUEST_AP; give(q.doneOn, award(QUEST_XP, a, 'Quest: ' + q.title)); } });
        if (wk.perfect.done) give(wk.perfect.doneOn, award(PERFECT_XP, {}, wk.isPre ? 'Perfect Preseason' : 'Perfect Week'));
        weeks.push(wk);
      }
    }

    var ratings = {}, total = 0;
    ATTRS.forEach(function (k) { ratings[k] = ratingFromAp(ap[k]); ratings[k].ap = ap[k]; total += ratings[k].rating; });
    var lv = levelFromXp(xp);

    // Week-based habit streaks: a week counts when a habit is hit on 5+ days.
    var thisWeek = weekStart(today);
    var firstDate = recs.length ? recs[0].date : today;
    var firstWeek = weekStart(firstDate);
    var habits = {};
    HABITS.forEach(function (h) {
      var done = function (d) { return !!(facts[d] && facts[d][h]); };
      var days = [];
      for (var i = 0; i < 7; i++) { var d = addDays(thisWeek, i); days.push({ date: d, done: done(d), future: d > today }); }
      var countWeek = function (ws) { var c = 0; for (var i = 0; i < 7; i++) if (done(addDays(ws, i))) c++; return c; };
      var best = 0, run = 0;
      for (var w = firstWeek; w < thisWeek; w = addDays(w, 7)) {
        var avail = Math.min(7, dayNum(addDays(w, 6)) - Math.max(dayNum(w), dayNum(firstDate)) + 1);
        if (countWeek(w) >= Math.min(5, avail)) { run++; best = Math.max(best, run); } else run = 0;
      }
      var streak = run, cur = countWeek(thisWeek);
      if (cur >= 5) { streak += 1; best = Math.max(best, streak); }
      habits[h] = { week: days, weekCount: cur, streak: streak, best: best, today: done(today) };
    });

    var chapters = Object.keys(echoDone).map(Number).sort(function (a, b) { return a - b; });

    return {
      today: today, xp: xp, level: lv.level, levelInto: lv.into, levelNeed: lv.need,
      title: titleFor(lv.level), nextTitle: nextTitle(lv.level),
      ratings: ratings, ovr: Math.round(total / ATTRS.length),
      byDay: byDay, facts: facts, habits: habits, season: seasonFor(today), readInfo: readInfo,
      week: weeks.length ? weeks[weeks.length - 1] : null, weeks: weeks,
      lastWorkout: lastWorkout,
      questLines: {
        manuscript: { chapters: chapters, done: chapters.length, total: ECHO_CHAPTERS },
        director: { wins: directorWins },
        wealth: { start: WEALTH_START, latest: wealthLatest, milestones: WEALTH_MILESTONES.map(function (m) { return { amt: m.amt, xp: m.xp, hitOn: wealthHit[m.amt] || null }; }), checkedThisMonth: !!wealthMonths[today.slice(0, 7)] }
      }
    };
  }

  var Engine = {
    ATTRS: ATTRS, ATTR_NAMES: ATTR_NAMES, HABITS: HABITS, SEASONS: SEASONS, TITLES: TITLES,
    CAREER_TIERS: CAREER_TIERS, WEALTH_MILESTONES: WEALTH_MILESTONES, WEALTH_START: WEALTH_START, ECHO_CHAPTERS: ECHO_CHAPTERS,
    WATER_BOTTLE_OZ: WATER_BOTTLE_OZ, WATER_GOAL_BOTTLES: WATER_GOAL_BOTTLES, STEPS_GOAL: STEPS_GOAL, READ_GOAL_PCT: READ_GOAL_PCT,
    QUEST_XP: QUEST_XP, PERFECT_XP: PERFECT_XP, KICKOFF: KICKOFF,
    compute: compute, xpToNext: xpToNext, levelFromXp: levelFromXp, ratingCost: ratingCost, ratingFromAp: ratingFromAp,
    seasonFor: seasonFor, weekStart: weekStart, addDays: addDays, localToday: localToday, titleFor: titleFor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine; else root.Engine = Engine;
})(this);
