/* Dynasty scoring engine.
   Pure functions: everything (XP, levels, ratings, streaks) is computed from the
   saved day records, never stored. Editing or deleting a record recalculates all
   of it, and logging the same thing twice cannot pay twice (one record per habit per day). */
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
    var y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), dd = String(now.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }

  /* ---------- curves ---------- */
  function xpToNext(level) { return Math.round(100 * Math.pow(level, 1.5)); }
  function levelFromXp(xp) {
    var level = 1, need = xpToNext(1), into = xp;
    while (into >= need) { into -= need; level += 1; need = xpToNext(level); }
    return { level: level, into: into, need: need };
  }
  function titleFor(level) {
    var t = TITLES[0].title;
    TITLES.forEach(function (x) { if (level >= x.level) t = x.title; });
    return t;
  }
  function nextTitle(level) {
    for (var i = 0; i < TITLES.length; i++) if (TITLES[i].level > level) return TITLES[i];
    return null;
  }
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
        var day = dayNum(date) - dayNum(s.start);
        var total = dayNum(s.end) - dayNum(s.start) + 1;
        return { id: s.id, label: s.label, focus: s.focus, start: s.start, end: s.end, day: day + 1, totalDays: total, week: Math.floor(day / 7) + 1, weeks: Math.ceil(total / 7) };
      }
    }
    var last = SEASONS[SEASONS.length - 1];
    return { id: 'off', label: 'Offseason', focus: last.focus, start: last.end, end: last.end, day: 0, totalDays: 0, week: 0, weeks: 0 };
  }

  /* ---------- per-record scoring ---------- */
  // Each award: { xp, ap: {ATTR: n}, label, done: bool }
  function award(xp, ap, label) { return { xp: xp, ap: ap, label: label }; }

  function readingDeltas(records) {
    // returns map date -> { delta, pct, book, finished }
    var reads = records.filter(function (r) { return r.type === 'read'; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var out = {}, prev = null;
    reads.forEach(function (r) {
      var v = r.value || {};
      var pct = Math.max(0, Math.min(100, Number(v.pct) || 0));
      var sameBook = prev && prev.book === v.book && !v.newBook;
      var base = sameBook ? prev.pct : 0;
      var delta = Math.max(0, pct - base);
      var finished = pct >= 100 && (!sameBook || prev.pct < 100);
      out[r.date] = { delta: delta, pct: pct, book: v.book, finished: finished };
      prev = { book: v.book, pct: pct };
    });
    return out;
  }

  function scoreRecord(r, readInfo) {
    var v = r.value, a = [];
    switch (r.type) {
      case 'water':
        if (v >= WATER_GOAL_BOTTLES) a.push(award(25, { FUE: 4, DIS: 3 }, 'Water goal'));
        else if (v >= 2) a.push(award(10, { FUE: 2 }, 'Water, 2 bottles'));
        break;
      case 'steps':
        if (v >= STEPS_GOAL) a.push(award(25, { CON: 4, DIS: 3 }, Number(v).toLocaleString('en-US') + ' steps'));
        break;
      case 'walk': if (v) a.push(award(15, { CON: 3, DIS: 2 }, 'Daily walk')); break;
      case 'vitamins': if (v) a.push(award(10, { REC: 2, DIS: 2 }, 'Vitamins')); break;
      case 'journal': if (v) a.push(award(20, { MND: 3, DIS: 3 }, 'Journal')); break;
      case 'read':
        var info = readInfo[r.date];
        if (info && info.delta >= READ_GOAL_PCT) {
          a.push(award(25, { MND: 5, DIS: 3 }, 'Read ' + info.delta + '%'));
          var extra = Math.min(3, Math.floor((info.delta - READ_GOAL_PCT) / 5));
          if (extra > 0) a.push(award(5 * extra, {}, 'Extra reading'));
        }
        if (info && info.finished) a.push(award(150, { MND: 15 }, 'Finished a book'));
        break;
    }
    return a;
  }

  function habitDone(r, readInfo) {
    var v = r.value;
    switch (r.type) {
      case 'water': return v >= WATER_GOAL_BOTTLES;
      case 'steps': return v >= STEPS_GOAL;
      case 'read': return !!(readInfo[r.date] && readInfo[r.date].delta >= READ_GOAL_PCT);
      case 'walk': case 'vitamins': case 'journal': return !!v;
    }
    return false;
  }

  /* ---------- full compute ---------- */
  function compute(records, today) {
    today = today || localToday();
    // Only the latest record per type+date counts (the store is keyed this way already).
    var latest = {};
    records.forEach(function (r) {
      var k = r.type + ':' + r.date;
      if (!latest[k] || (r.updatedAt || 0) >= (latest[k].updatedAt || 0)) latest[k] = r;
    });
    var recs = Object.keys(latest).map(function (k) { return latest[k]; }).filter(function (r) { return r.date <= today; });
    var readInfo = readingDeltas(recs);

    var xp = 0, ap = {}, byDay = {}, done = {};
    ATTRS.forEach(function (k) { ap[k] = 0; });
    HABITS.forEach(function (h) { done[h] = {}; });

    recs.forEach(function (r) {
      var focus = seasonFor(r.date).focus;
      var awards = scoreRecord(r, readInfo);
      var day = byDay[r.date] || (byDay[r.date] = { xp: 0, awards: [] });
      awards.forEach(function (aw) {
        xp += aw.xp; day.xp += aw.xp; day.awards.push(aw);
        Object.keys(aw.ap).forEach(function (k) {
          ap[k] += aw.ap[k] * (focus.indexOf(k) >= 0 ? FOCUS_MULT : 1);
        });
      });
      if (done[r.type] && habitDone(r, readInfo)) done[r.type][r.date] = true;
    });

    var ratings = {};
    var sum = 0;
    ATTRS.forEach(function (k) { ratings[k] = ratingFromAp(ap[k]); ratings[k].ap = ap[k]; sum += ratings[k].rating; });
    var lv = levelFromXp(xp);

    // Week-based streaks: a week counts when a habit is hit on 5+ of its days.
    var thisWeek = weekStart(today);
    var firstDate = recs.length ? recs.reduce(function (m, r) { return r.date < m ? r.date : m; }, today) : today;
    var firstWeek = weekStart(firstDate);
    var habits = {};
    HABITS.forEach(function (h) {
      var days = [];
      for (var i = 0; i < 7; i++) { var d = addDays(thisWeek, i); days.push({ date: d, done: !!done[h][d], future: d > today }); }
      var countWeek = function (ws) { var c = 0; for (var i = 0; i < 7; i++) if (done[h][addDays(ws, i)]) c++; return c; };
      var streak = 0, best = 0, run = 0;
      for (var ws = firstWeek; ws < thisWeek; ws = addDays(ws, 7)) {
        // A partial first week (app started mid-week) needs 5 of the days that existed, max.
        var avail = Math.min(7, dayNum(addDays(ws, 6)) - Math.max(dayNum(ws), dayNum(firstDate)) + 1);
        if (countWeek(ws) >= Math.min(5, avail)) { run++; best = Math.max(best, run); } else run = 0;
      }
      streak = run;
      var cur = countWeek(thisWeek);
      if (cur >= 5) { streak += 1; best = Math.max(best, streak); }
      habits[h] = { week: days, weekCount: cur, streak: streak, best: best, today: !!done[h][today] };
    });

    return {
      today: today, xp: xp, level: lv.level, levelInto: lv.into, levelNeed: lv.need,
      title: titleFor(lv.level), nextTitle: nextTitle(lv.level),
      ratings: ratings, ovr: Math.round(sum / ATTRS.length),
      byDay: byDay, habits: habits, season: seasonFor(today), readInfo: readInfo
    };
  }

  var Engine = {
    ATTRS: ATTRS, ATTR_NAMES: ATTR_NAMES, HABITS: HABITS, SEASONS: SEASONS, TITLES: TITLES,
    WATER_BOTTLE_OZ: WATER_BOTTLE_OZ, WATER_GOAL_BOTTLES: WATER_GOAL_BOTTLES, STEPS_GOAL: STEPS_GOAL, READ_GOAL_PCT: READ_GOAL_PCT,
    compute: compute, xpToNext: xpToNext, levelFromXp: levelFromXp, ratingCost: ratingCost, ratingFromAp: ratingFromAp,
    seasonFor: seasonFor, weekStart: weekStart, addDays: addDays, localToday: localToday, titleFor: titleFor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine; else root.Engine = Engine;
})(this);
