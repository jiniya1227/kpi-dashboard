// KPI 실적 현황 — app.js
// [1] 데이터 읽기·저장 부분  [2] 화면 코드  (Supabase 연결 때는 [1]만 바꿉니다)

// ===== [1] 데이터 읽기·저장 =====
// 지금은 샘플 모드: 가상 샘플을 이 브라우저(localStorage)에만 저장합니다.
// 나중에 Supabase를 연결할 때는 이 파일의 list / add / update / remove 안쪽만 바꾸면 됩니다.
(function () {
  var STORAGE_KEY = 'kpi_records_sample_v1';

  // 가상 샘플 6건 — 전체 합계: 목표 60,000,000 / 실적 59,400,000 / 달성률 99%
  var SAMPLE = [
    { id: 'K001', month: '2026-09', team: '영업A', target: 10000000, actual: 9500000 },
    { id: 'K002', month: '2026-09', team: '영업B', target: 8000000, actual: 7600000 },
    { id: 'K003', month: '2026-09', team: '영업C', target: 12000000, actual: 11500000 },
    { id: 'K004', month: '2026-10', team: '영업A', target: 10000000, actual: 11000000 },
    { id: 'K005', month: '2026-10', team: '영업B', target: 8000000, actual: 7200000 },
    { id: 'K006', month: '2026-10', team: '영업C', target: 12000000, actual: 12600000 }
  ];

  var memory = null; // localStorage를 쓸 수 없을 때(사생활 보호 창 등) 대신 쓰는 임시 보관

  function clone(rows) { return rows.map(function (r) { return Object.assign({}, r); }); }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 아래에서 샘플 사용 */ }
    if (memory) return clone(memory);
    return clone(SAMPLE);
  }

  function save(rows) {
    memory = clone(rows);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch (e) { /* 메모리에만 유지 */ }
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  // 저장 규칙 검사 — 화면에서 먼저 안내하고, DB 연결 후에는 DB 규칙이 최종 검사를 맡습니다.
  function validate(input, rows, editingId) {
    var errors = {};
    var month = String(input.month || '').trim();
    var team = String(input.team || '').trim().replace(/\s+/g, ' ');
    var m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m || +m[2] < 1 || +m[2] > 12) errors.month = '월은 2026-10처럼 YYYY-MM 형식(01~12월)으로 입력하세요.';
    if (team.length < 1) errors.team = '부서명을 입력하세요.';
    else if (team.length > 80) errors.team = '부서명은 80자 이하로 입력하세요.';

    function money(v, key, label, eul, eun, i) {
      var s = String(v == null ? '' : v).replace(/[,\s원]/g, '');
      if (s === '') { errors[key] = label + eul + ' 입력하세요.'; return null; }
      if (!/^\d+$/.test(s)) { errors[key] = label + eun + ' 0 이상의 정수(원 단위)만 입력할 수 있어요.'; return null; }
      var n = Number(s);
      if (!Number.isSafeInteger(n)) { errors[key] = label + i + ' 너무 큽니다.'; return null; }
      return n;
    }
    var target = money(input.target, 'target', '목표', '를', '는', '가');
    var actual = money(input.actual, 'actual', '실적', '을', '은', '이');

    if (!errors.month && !errors.team) {
      var dup = rows.some(function (r) { return r.id !== editingId && r.month === month && r.team === team; });
      if (dup) errors.team = month + ' ' + team + ' 자료가 이미 있습니다. 표에서 [수정]을 눌러 고쳐 주세요.';
    }
    return { ok: Object.keys(errors).length === 0, errors: errors, value: { month: month, team: team, target: target, actual: actual } };
  }

  // 화면에서 쓰는 함수들 — 모두 Promise로 돌려줘서 나중에 서버 요청으로 바꾸기 쉽게 했습니다.
  window.KpiStore = {
    mode: 'sample',
    list: function () { return Promise.resolve(load()); },
    validate: function (input, editingId) { return validate(input, load(), editingId); },
    add: function (input) {
      var rows = load();
      var v = validate(input, rows, null);
      if (!v.ok) return Promise.reject(v);
      var row = Object.assign({ id: newId() }, v.value);
      rows.push(row); save(rows);
      return Promise.resolve(row);
    },
    update: function (id, input) {
      var rows = load();
      var i = rows.findIndex(function (r) { return r.id === id; });
      if (i < 0) return Promise.reject({ ok: false, errors: { form: '수정할 자료를 찾지 못했어요. 새로고침 후 다시 시도하세요.' } });
      var v = validate(input, rows, id);
      if (!v.ok) return Promise.reject(v);
      rows[i] = Object.assign({ id: id }, v.value); save(rows);
      return Promise.resolve(rows[i]);
    },
    remove: function (id) {
      var rows = load().filter(function (r) { return r.id !== id; });
      save(rows);
      return Promise.resolve();
    },
    resetSample: function () { save(clone(SAMPLE)); return Promise.resolve(); }
  };
})();

// ===== [2] 화면 코드 =====
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var rows = [];
  var editingId = null;

  function won(n) { return n.toLocaleString('ko-KR'); }
  // 퍼센트는 마지막 표시 단계에서만 소수 둘째 자리로 반올림
  function pct(actual, target) {
    if (target === 0) return null;
    return Math.round(actual / target * 10000) / 100;
  }
  function pctText(p) { return p === null ? '목표 미설정' : p.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '%'; }
  function pill(p) {
    var cls = p === null ? 'none' : (p >= 100 ? 'up' : 'down');
    return '<span class="pill ' + cls + '">' + pctText(p) + '</span>';
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function monthText(m) { var p = m.split('-'); return p[0] + '년 ' + Number(p[1]) + '월'; }

  function sum(list, key) { return list.reduce(function (a, r) { return a + r[key]; }, 0); }

  function fillSelect(sel, values, allLabel, fmt) {
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + allLabel + '</option>' + values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(fmt ? fmt(v) : v) + '</option>';
    }).join('');
    sel.value = values.indexOf(cur) >= 0 ? cur : '';
  }

  function filtered() {
    var m = $('fMonth').value, t = $('fTeam').value;
    return rows.filter(function (r) { return (!m || r.month === m) && (!t || r.team === t); })
      .sort(function (a, b) { return a.month === b.month ? a.team.localeCompare(b.team, 'ko') : (a.month < b.month ? 1 : -1); });
  }

  function render() {
    var months = Array.from(new Set(rows.map(function (r) { return r.month; }))).sort().reverse();
    var teams = Array.from(new Set(rows.map(function (r) { return r.team; }))).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
    fillSelect($('fMonth'), months, '전체 월', monthText);
    fillSelect($('fTeam'), teams, '전체 부서');
    $('teamList').innerHTML = teams.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('');

    var list = filtered();
    var tSum = sum(list, 'target'), aSum = sum(list, 'actual');
    var safe = Number.isSafeInteger(tSum) && Number.isSafeInteger(aSum);
    var p = list.length && safe ? pct(aSum, tSum) : null;

    $('sTarget').innerHTML = list.length ? won(tSum) + '<small>원</small>' : '-';
    $('sActual').innerHTML = list.length ? won(aSum) + '<small>원</small>' : '-';
    $('sCount').innerHTML = list.length + '<small>건</small>';
    $('sRate').textContent = !list.length ? '-' : (safe ? pctText(p) : '계산 범위 초과');
    $('sBar').style.width = p === null ? '0' : Math.min(p, 100) + '%';

    // 부서별 비교 (현재 필터 기준으로 부서끼리 합산)
    var byTeam = {};
    list.forEach(function (r) {
      byTeam[r.team] = byTeam[r.team] || { target: 0, actual: 0 };
      byTeam[r.team].target += r.target; byTeam[r.team].actual += r.actual;
    });
    var names = Object.keys(byTeam).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
    var max = Math.max.apply(null, names.map(function (n) { return Math.max(byTeam[n].target, byTeam[n].actual); }).concat([1]));
    $('chartScope').textContent = $('fMonth').value ? monthText($('fMonth').value) : '전체 월 합산';
    $('chart').innerHTML = names.length ? names.map(function (n) {
      var d = byTeam[n], tp = pct(d.actual, d.target);
      return '<div class="chart-row"><div class="name"><b>' + esc(n) + '</b><span>' + won(d.actual) + ' / ' + won(d.target) + '원 · ' + pctText(tp) + '</span></div>' +
        '<div class="track"><div class="actual' + (tp !== null && tp >= 100 ? ' over' : '') + '" style="width:' + (d.actual / max * 100) + '%"></div>' +
        '<div class="goal" style="left:calc(' + (d.target / max * 100) + '% - 2px)"></div></div></div>';
    }).join('') : '<div class="empty"><b>표시할 자료가 없어요</b>필터를 바꾸거나 실적을 입력해 보세요.</div>';

    // 근거표
    $('tbody').innerHTML = list.length ? list.map(function (r) {
      return '<tr' + (r.id === editingId ? ' class="editing"' : '') + '><td>' + esc(r.month) + '</td><td>' + esc(r.team) + '</td>' +
        '<td class="num">' + won(r.target) + '</td><td class="num">' + won(r.actual) + '</td><td class="num">' + pill(pct(r.actual, r.target)) + '</td>' +
        '<td><div class="actions"><button class="btn ghost small" data-edit="' + esc(r.id) + '">수정</button><button class="btn danger small" data-del="' + esc(r.id) + '">삭제</button></div></td></tr>';
    }).join('') : '<tr><td colspan="6"><div class="empty"><b>' + (rows.length ? '조건에 맞는 자료가 없어요' : '아직 입력된 자료가 없어요') + '</b>' +
      (rows.length ? '필터를 [필터 초기화]로 되돌려 보세요.' : '위의 실적 입력에서 첫 자료를 저장하거나, 샘플 6건을 불러오세요.') + '</div></td></tr>';
    $('tfoot').innerHTML = list.length ? '<tr><td colspan="2">합계 (' + list.length + '건)</td><td class="num">' + won(tSum) + '</td><td class="num">' + won(aSum) + '</td><td class="num">' + pill(p) + '</td><td></td></tr>' : '';
  }

  function reload() {
    return KpiStore.list().then(function (data) { rows = data; render(); })
      .catch(function () { showToast('자료를 불러오지 못했어요. 새로고침해 주세요.', false); });
  }

  // 안내 메시지
  var toastTimer;
  function showToast(msg, ok) {
    var t = $('toast');
    t.textContent = msg; t.className = 'toast show ' + (ok ? 'ok' : 'fail');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, ok ? 3500 : 7000);
  }

  function clearErrors() {
    document.querySelectorAll('#form .field').forEach(function (f) { f.classList.remove('invalid'); f.querySelector('.err').textContent = ''; });
  }
  function showErrors(errors) {
    Object.keys(errors).forEach(function (k) {
      var f = document.querySelector('#form .field[data-f="' + k + '"]');
      if (f) { f.classList.add('invalid'); f.querySelector('.err').textContent = errors[k]; }
    });
    showToast(errors.form || '입력값을 확인해 주세요. 저장되지 않았습니다.', false);
  }

  function setEditing(id) {
    editingId = id;
    var r = rows.find(function (x) { return x.id === id; });
    clearErrors();
    if (r) {
      $('iMonth').value = r.month; $('iTeam').value = r.team;
      $('iTarget').value = won(r.target); $('iActual').value = won(r.actual);
      $('saveBtn').textContent = '수정 저장'; $('cancelBtn').hidden = false;
      $('form').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('iActual').focus({ preventScroll: true });
    } else {
      $('form').reset(); editingId = null;
      $('saveBtn').textContent = '저장'; $('cancelBtn').hidden = true;
    }
    render();
  }

  // 금액 입력 시 자동으로 쉼표 넣기
  ['iTarget', 'iActual'].forEach(function (id) {
    $(id).addEventListener('input', function (e) {
      var digits = e.target.value.replace(/[^\d]/g, '');
      if (digits && /^[\d,\s원]*$/.test(e.target.value)) e.target.value = Number(digits).toLocaleString('ko-KR');
    });
  });

  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();
    var input = { month: $('iMonth').value, team: $('iTeam').value, target: $('iTarget').value, actual: $('iActual').value };
    var wasEditing = editingId;
    var job = editingId ? KpiStore.update(editingId, input) : KpiStore.add(input);
    job.then(function (row) {
      setEditing(null);
      return reload().then(function () {
        showToast(row.month + ' ' + row.team + ' 실적을 ' + (wasEditing ? '수정했어요.' : '저장했어요.'), true);
      });
    }).catch(function (v) {
      showErrors((v && v.errors) || { form: '저장하지 못했어요. 다시 시도해 주세요.' });
    });
  });

  $('cancelBtn').addEventListener('click', function () { setEditing(null); });

  $('tbody').addEventListener('click', function (e) {
    var ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) setEditing(ed.getAttribute('data-edit'));
    if (del) {
      var r = rows.find(function (x) { return x.id === del.getAttribute('data-del'); });
      if (!r || !confirm(r.month + ' ' + r.team + ' 자료를 삭제할까요?')) return;
      KpiStore.remove(r.id).then(function () {
        if (editingId === r.id) setEditing(null);
        return reload();
      }).then(function () { showToast(r.month + ' ' + r.team + ' 자료를 삭제했어요.', true); });
    }
  });

  $('fMonth').addEventListener('change', render);
  $('fTeam').addEventListener('change', render);
  $('fReset').addEventListener('click', function () { $('fMonth').value = ''; $('fTeam').value = ''; render(); });
  $('sampleBtn').addEventListener('click', function () {
    if (!confirm('지금 자료를 지우고 가상 샘플 6건으로 되돌릴까요?')) return;
    KpiStore.resetSample().then(function () { setEditing(null); return reload(); })
      .then(function () { showToast('샘플 6건으로 되돌렸어요.', true); });
  });

  reload();
})();
