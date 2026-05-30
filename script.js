// ===== 환경 =====
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyTtJ9LxD8XwODBF6USyRgru66duZO0f_sIVweehINlafifl3WV8rHVfyN_5bV9UY3RNQ/exec';
const PRICE = { adult: 7000, youth: 5000 };
const STORAGE_KEY = 'jb-reserve-draft-v3'; // v3: 디자인/UX 개선 반영

// ===== 유틸 =====
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const vibrate = ms => { if (navigator.vibrate) navigator.vibrate(ms); };
const fmt = n => Number(n).toLocaleString();

function nearest20Slot(base = new Date()) {
  const slots = [0, 20, 40];
  const d = new Date(base);
  let h = d.getHours(), m = d.getMinutes();
  let chosen = slots.find(s => m <= s + 3);
  if (chosen === undefined) { h = (h + 1) % 24; chosen = 0; }
  return `${String(h).padStart(2, '0')}:${String(chosen).padStart(2, '0')}`;
}

function saveDraft(obj) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch {} }
function loadDraft() { try { const t = localStorage.getItem(STORAGE_KEY); return t ? JSON.parse(t) : null; } catch { return null; } }
function clearDraft(){ try { localStorage.removeItem(STORAGE_KEY); } catch {} }

function showSnack(msg, type = 'info', ms = 1800) {
  const el = $('#snackbar');
  el.textContent = msg;
  el.className = `snackbar ${type} show`;
  $('#liveRegion').textContent = msg;
  setTimeout(() => el.classList.remove('show'), ms);
}

function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

// ===== 메인 =====
document.addEventListener('DOMContentLoaded', () => {
  const form = $('#reservationForm');
  const result = $('#result');
  const submitBtn = $('#submitBtn');
  const resetBtn = $('#resetBtn');

  const priceText = $('#priceText');
  const priceDetail = $('#priceDetail');
  const summaryText = $('#summaryText');

  const roomButtons = $$('.room-buttons .seg');
  const roomInput = $('#roomSize');

  const diffButtons = $$('.difficulty-buttons .diff');
  const diffInput = $('#difficulty');
  
  // ✅ 2/3번 동의(필수)
  const agree23 = $('#agree23');

  const stepperFill = $('#stepperFill');
  const dots = $$('.dot');
  // ✅ 예약시간 드롭다운
  const walkInInput = $('#walkInTime');
  const walkInSelect = $('#walkInSelect');
  let userPickedTime = false;
  let isSubmitting = false;
  let lastSubmitFingerprint = '';
  let lastSubmitAt = 0;
  const DUPLICATE_SUBMIT_MS = 60 * 1000;

  const timeToMin = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return (h * 60) + m;
  };
  const minToTime = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  function buildTimeOptions(preserve = true) {
    if (!walkInSelect) return;

    const prev = walkInSelect.value;
    walkInSelect.innerHTML = '';

    // 기본값: 기존 로직(nearest20Slot) 그대로 사용
    let base = nearest20Slot(new Date());
    let startMin = timeToMin(base);
    const endMin = 23 * 60; // 23:00까지

    // 만약 시간이 너무 늦어서 base가 23:00 넘어가는 케이스면 23:00만
    if (startMin > endMin) startMin = endMin;

    for (let t = startMin; t <= endMin; t += 20) {
      const v = minToTime(t);
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      walkInSelect.appendChild(opt);
    }

    // 값 유지(가능하면), 아니면 첫 옵션(=기본값)
    if (preserve && prev && Array.from(walkInSelect.options).some(o => o.value === prev)) {
      walkInSelect.value = prev;
    } else {
      walkInSelect.selectedIndex = 0;
    }

    // hidden input도 동기화
    if (walkInInput) walkInInput.value = walkInSelect.value;
  }


  // 최초 옵션 생성
  buildTimeOptions(false);

  // ✅ 백그라운드/잠금 후 복귀 시 즉시 최신 옵션 반영
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !userPickedTime) buildTimeOptions(true);
  });
  window.addEventListener('focus', () => {
    if (!userPickedTime) buildTimeOptions(true);
  });

  // 사용자가 직접 변경하면 그 값 유지
  walkInSelect?.addEventListener('change', () => {
    userPickedTime = true;
    if (walkInInput) walkInInput.value = walkInSelect.value;
    updateDraft?.();
  });


  // 사용자가 직접 변경하면 그 값 유지
  walkInSelect?.addEventListener('change', () => {
    userPickedTime = true;
    if (walkInInput) walkInInput.value = walkInSelect.value;
    updateDraft?.(); // 아래에 updateDraft 확장하면 자동 저장됨
  });

setInterval(() => {
  // ✅ 사용자가 직접 선택한 상태면 자동 갱신 금지
  // (단, 선택한 시간이 '유효하지 않게 되었는지'만 체크해서 필요 시 보정)
  const prev = walkInSelect?.value || '';
  if (!walkInSelect) return;

  // 드롭다운 조작 중이면 갱신/보정 금지(열어둔 상태에서 튀는 거 방지)
  if (document.activeElement === walkInSelect) return;

  // 1) 옵션 목록을 새로 만들기 (유저가 선택 안 했을 때만)
  if (!userPickedTime) {
    buildTimeOptions(true);
    return;
  }

  // 2) 유저가 선택한 상태면 "그 값이 아직 옵션에 존재하는지"만 확인
  const stillExists = Array.from(walkInSelect.options).some(o => o.value === prev);

  // 옵션을 최신으로 재생성해서(현재 시간 기준) prev가 사라졌는지 판단
  // → 이때도 buildTimeOptions는 prev 유지 시도하므로, 사라졌으면 값이 달라짐
  buildTimeOptions(true);

  if (userPickedTime && prev && !Array.from(walkInSelect.options).some(o => o.value === prev)) {
    // 선택한 시간이 이제 불가능하면 다음 가능한 시간으로 자동 보정
    userPickedTime = false; // 이후는 자동 갱신 허용(원하면 true로 둬도 됨)
    showSnack('선택한 시간이 지나서 다음 가능한 시간으로 바꿨어요 🙂', 'warn', 1600);
    updateDraft?.();
  }
}, 10 * 1000);



  
function syncStickybarHeight(){
  const bar = document.querySelector('.stickybar');
  if (!bar) return;
  document.documentElement.style.setProperty('--stickybar-h', `${bar.offsetHeight}px`);
}

syncStickybarHeight();
window.addEventListener('resize', syncStickybarHeight);
  // 팀명 자동 생성
  const teamNameList = [
    '순대','떡볶이','대박','제로콜라','불고기와퍼','보노보노','요리왕비룡','검정고무신','도라에몽',
    '런닝맨','호빵맨','괴짜가족','우르사','쿠쿠다스','갈비탕','돼지국밥','순대국','파리지옥',
    '은하철도999','아이언맨','호나우딩요','독수리슛','번개슛','피구왕통키','도깨비슛'
  ];
  const teamPrefix = ['점핑', '번쩍', '퐁당', '쌩쌩', '두근', '말랑', '깡총', '폭주'];

  function makeTeamName(){
    const base = pick(teamNameList);
    const pre = pick(teamPrefix);
    // 너무 길어지면 prefix 없이
    const name = (pre + base).slice(0, 20);
    return name;
  }
  function scrollToField(el) {
  // 키보드 올라오는 타이밍 때문에 살짝 딜레이
  setTimeout(() => {
    const offset = 150; // stickybar + 여유
    const y = el.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }, 220);
}

['vehicle', 'teamName', 'adultCount', 'youthCount'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('focus', () => scrollToField(el));
});
  // 방/난이도 선택 토글
  roomButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      roomButtons.forEach(b => { b.classList.remove('selected'); b.setAttribute('aria-checked', 'false'); });
      btn.classList.add('selected');
      btn.setAttribute('aria-checked', 'true');
      roomInput.value = btn.dataset.value;
      vibrate(10);
      refresh();
    });
  });

  diffButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // ✅ 동의 체크 안 했으면 난이도 선택 막고 안내
      if (agree23 && !agree23.checked) {
        showSnack('동의 먼저 체크해주세요 🙂', 'warn', 1600);
        vibrate(20);
  
        const card = agree23.closest('.agree-card') || agree23;
        scrollToField(card);
        return;
      }
  
      diffButtons.forEach(b => { b.classList.remove('selected'); b.setAttribute('aria-checked', 'false'); });
      btn.classList.add('selected');
      btn.setAttribute('aria-checked', 'true');
      diffInput.value = btn.dataset.value;
      vibrate(10);
      refresh();
    });
  });


  // 인원 카운터 +/-
  function adjustCount(id, delta) {
    const inp = document.getElementById(id);
    const v = Math.max(0, (Number(inp.value) || 0) + delta);
    inp.value = v;
    vibrate(8);
    refresh();
  }
  $$('.btn-ghost.minus').forEach(b => b.addEventListener('click', () => adjustCount(b.dataset.target, -1)));
  $$('.btn-ghost.plus').forEach(b => b.addEventListener('click', () => adjustCount(b.dataset.target, 1)));

  $('#adultCount').addEventListener('input', refresh);
  $('#youthCount').addEventListener('input', refresh);

  // 팀명 자동 생성/추천
  $('#generateTeamNameBtn').addEventListener('click', () => {
    $('#teamName').value = makeTeamName();
    vibrate(10);
    refresh();
  });
  $('#suggestBtn').addEventListener('click', () => {
    const t = $('#teamName').value.trim();
    if (!t) {
      $('#teamName').value = makeTeamName();
      showSnack('추천 팀명 넣어드렸어요! 😆', 'ok', 1400);
    } else {
      showSnack('팀명 너무 좋아요! 그대로 OK 👌', 'ok', 1400);
    }
    vibrate(10);
    refresh();
  });

  $('#teamName').addEventListener('input', refresh);
  
  // ✅ 동의 체크 변경 시 제출 가능 여부 갱신
  agree23?.addEventListener('change', refresh);


  // 차량번호 숫자 4자리 제한
  $('#vehicle').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    refresh();
  });

  // ✅ 동의 체크
  agree23?.addEventListener('change', refresh);

  // 가격 표시
  function syncPrice() {
    const adult = Number($('#adultCount').value || 0);
    const youth = Number($('#youthCount').value || 0);
    const adultAmt = adult * PRICE.adult;
    const youthAmt = youth * PRICE.youth;
    const total = adultAmt + youthAmt;
    priceText.textContent = fmt(total);
    priceDetail.textContent = `성인 ${adult} × ${fmt(PRICE.adult)} + 청소년 ${youth} × ${fmt(PRICE.youth)}`;
  syncStickybarHeight(); // ✅ 추가
  }

  function updateDraft() {
    saveDraft({
      roomSize: roomInput.value || '',
      difficulty: diffInput.value || '',
      walkInTime: (walkInSelect?.value || ''), // ✅ 추가
      adultCount: Number($('#adultCount').value || 0),
      youthCount: Number($('#youthCount').value || 0),
      teamName: ($('#teamName').value || '').trim(),
      vehicle: ($('#vehicle').value || '').trim(),
      agree23: !!agree23?.checked
    });
  }


  function computeProgress() {
    const room = !!roomInput.value;
    const adult = Number($('#adultCount').value || 0);
    const youth = Number($('#youthCount').value || 0);
    const people = (adult + youth) > 0;
    const team = ($('#teamName').value || '').trim().length > 0;
    const diff = !!diffInput.value;
    // 4개 체크포인트: 방/인원+팀명/난이도/차량(선택이라 진행도에는 미반영)
    const done = [room, (people && team), diff].filter(Boolean).length;
    // 0~3 단계 -> 0~100
    const pct = Math.round((done / 3) * 100);
    return { done, pct, room, people, team, diff };
  }

  function updateStepper() {
    const { done, pct } = computeProgress();
    stepperFill.style.width = `${pct}%`;
    dots.forEach((d, i) => {
      d.classList.toggle('on', i < Math.max(1, done + 1)); // 시작점도 켜지게
    });
  }

  function updateSummary() {
    const room = roomInput.value ? `방: ${roomInput.value}` : '방: 미선택';
    const diff = diffInput.value ? `난이도: ${diffInput.value.replace(/^[ㄱ-ㅎ]/, '')}` : '난이도: 미선택';
    const adult = Number($('#adultCount').value || 0);
    const youth = Number($('#youthCount').value || 0);
    const people = (adult + youth) > 0 ? `인원: ${adult + youth}명 (성인 ${adult}, 청소년 ${youth})` : '인원: 0명';
    summaryText.textContent = `${room} · ${diff} · ${people}`;
  }

  function isReadyToSubmit() {
    const room = roomInput.value;
    const adult = Number($('#adultCount').value || 0);
    const youth = Number($('#youthCount').value || 0);
    const team = ($('#teamName').value || '').trim();
    const diff = diffInput.value;
    return !!room && (adult + youth > 0) && !!team && !!diff && (!agree23 || agree23.checked);

  }

  function refresh() {
    syncPrice();
    updateDraft();
    updateStepper();
    updateSummary();
    submitBtn.disabled = !isReadyToSubmit();
  }

  // Draft 복원
  (function restore() {
    const d = loadDraft();
    if (!d) { refresh(); return; }

    if (d.roomSize) {
      const btn = Array.from(roomButtons).find(b => b.dataset.value === d.roomSize);
      if (btn) btn.click();
      else roomInput.value = d.roomSize;
    }
    if (d.difficulty) {
      const btn = Array.from(diffButtons).find(b => b.dataset.value === d.difficulty);
      if (btn) btn.click();
      else diffInput.value = d.difficulty;
    }
    if (Number.isFinite(d.adultCount)) $('#adultCount').value = d.adultCount;
    if (Number.isFinite(d.youthCount)) $('#youthCount').value = d.youthCount;
    if (d.teamName) $('#teamName').value = d.teamName;
    if (d.vehicle) $('#vehicle').value = d.vehicle;
    if (typeof d.agree23 === 'boolean' && agree23) agree23.checked = d.agree23;
    if (d.walkInTime && walkInSelect && Array.from(walkInSelect.options).some(o => o.value === d.walkInTime)) {
      walkInSelect.value = d.walkInTime;
      userPickedTime = true;
      if (walkInInput) walkInInput.value = d.walkInTime;
    }

    // 버튼 클릭 복원 과정에서 refresh가 호출될 수 있으니 마지막에 한번 더
    refresh();
  })();

  // 검증
  function validate() {
    if (!roomInput.value) return '방을 선택해주세요.';
    const adult = Number($('#adultCount').value || 0);
    const youth = Number($('#youthCount').value || 0);
    if (adult + youth <= 0) return '인원 수를 입력해주세요.';
    if (!($('#teamName').value || '').trim()) return '팀명을 입력해주세요.';
    if (!diffInput.value) return '난이도를 선택해주세요.';
    if (agree23 && !agree23.checked) return '동의 먼저 체크해주세요.';

    return '';
  }

  function getPayloadFingerprint(payload) {
    return JSON.stringify(payload);
  }

  // 전송
  async function sendPayload(payload) {
    try {
      await fetch(SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  // 전체 리셋
  function hardReset() {
    form.reset();

    userPickedTime = false;
    buildTimeOptions(false); // ✅ 기본값(기존 로직)으로 다시 생성


    roomButtons.forEach(b => { b.classList.remove('selected'); b.setAttribute('aria-checked','false'); });
    diffButtons.forEach(b => { b.classList.remove('selected'); b.setAttribute('aria-checked','false'); });
    roomInput.value = '';
    diffInput.value = '';

    clearDraft();

    result.hidden = true;
    result.innerHTML = '';

    refresh();
  }

  resetBtn.addEventListener('click', () => {
    hardReset();
    showSnack('초기화했어요 🙂', 'ok', 1400);
    vibrate(12);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // 제출
  submitBtn.addEventListener('click', async () => {
    if (isSubmitting) {
      showSnack('이미 전송 중입니다. 잠시만 기다려주세요.', 'warn', 1400);
      return;
    }

    const msg = validate();
    if (msg) { showSnack(msg, 'warn'); vibrate(20); return; }

    const slotStr = (walkInSelect?.value || nearest20Slot(new Date()));
    $('#walkInTime').value = slotStr;


    const adult = Number($('#adultCount').value || 0);
    const youth = Number($('#youthCount').value || 0);

    const payload = {
      walkInTime: slotStr,
      roomSize: roomInput.value,
      teamName: ($('#teamName').value || '').trim(),
      difficulty: diffInput.value,
      totalCount: adult + youth,
      youthCount: youth,
      vehicle: ($('#vehicle').value || '').trim(),
      agree23: agree23?.checked ? '동의하였습니다' : ''
    };

    const now = Date.now();
    const fingerprint = getPayloadFingerprint(payload);
    if (fingerprint === lastSubmitFingerprint && (now - lastSubmitAt) < DUPLICATE_SUBMIT_MS) {
      showSnack('같은 예약 정보가 이미 전송되었습니다.', 'warn', 1800);
      vibrate(20);
      return;
    }

    isSubmitting = true;
    lastSubmitFingerprint = fingerprint;
    lastSubmitAt = now;
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    const ok = await sendPayload(payload);

    isSubmitting = false;
    submitBtn.classList.remove('loading');

    if (ok) {
      vibrate(15);
      result.hidden = false;
      result.innerHTML = `✅ <strong>전송 완료!</strong><br>예약 정보가 정상 전송되었습니다 🎉`;
      showSnack('예약 정보가 전송되었습니다.', 'ok', 2000);

      // 성공 후 리셋
      hardReset();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      showSnack('전송에 실패했습니다. 네트워크 상태 확인 후 다시 시도해주세요.', 'error', 2500);
      submitBtn.disabled = !isReadyToSubmit();
    }
  });

  // 첫 로드
  refresh();
});
