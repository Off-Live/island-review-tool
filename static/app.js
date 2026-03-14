let items = [];
let results = {};
let selectedIndex = 0;
let filterMode = 'all';
let categoryFilter = 'all';
let currentTab = 'item';

const EMOJI_MAP = {
  fruits: '🍎',
  vegetables: '🥦',
  everyday: '🏠',
};

// ── Regeneration state ──
// Tracks all regen items across all jobs: key -> {status, step, error, jobId, finishedAt}
let regenItems = {};
let regenPollingInterval = null;
let activeJobIds = new Set();
let refreshedKeys = new Set();

function init(itemData) {
  items = itemData;
  fetch('/results')
    .then(r => r.json())
    .then(data => {
      results = data;
      render();
      loadFailedItems();
      startGlobalPolling();
    });
}

function getFilteredItems() {
  return items.filter(item => {
    const key = item.category + '/' + item.name;
    const status = results[key];
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
    if (filterMode === 'unreviewed') return !status;
    if (filterMode === 'pass') return status === 'pass';
    if (filterMode === 'fail') return status === 'fail';
    return true;
  });
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.getElementById('item-view').style.display = tab === 'item' ? '' : 'none';
  document.getElementById('grid-view').style.display = tab === 'grid' ? '' : 'none';
  render();
}

function render() {
  updateProgress();
  updateFilterButtons();
  if (currentTab === 'item') {
    renderItemView();
  } else {
    renderGridView();
  }
}

function updateProgress() {
  const total = items.length;
  const passed = Object.values(results).filter(v => v === 'pass').length;
  const failed = Object.values(results).filter(v => v === 'fail').length;
  const reviewed = passed + failed;

  document.getElementById('progress-pass').style.width = (passed / total * 100) + '%';
  document.getElementById('progress-fail').style.width = ((passed + failed) / total * 100) + '%';
  document.getElementById('progress-fail').style.left = '0';
  document.getElementById('progress-pass').style.position = 'absolute';
  document.getElementById('progress-pass').style.top = '0';
  document.getElementById('progress-pass').style.zIndex = '2';
  document.getElementById('progress-fail').style.zIndex = '1';
  document.getElementById('progress-text').textContent =
    `${reviewed} / ${total} reviewed | ${passed} passed | ${failed} failed`;
}

function updateFilterButtons() {
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filterMode);
  });
  document.querySelectorAll('[data-category]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === categoryFilter);
  });
}

// ── Helper: check if a key is currently regenerating ──
function isRegenerating(key) {
  const ri = regenItems[key];
  return ri && (ri.status === 'pending' || ri.status === 'running');
}

// ── Item View ──

function renderItemView() {
  const filtered = getFilteredItems();
  const container = document.getElementById('item-view');

  if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="item-empty">No items match current filters.</div>';
    return;
  }

  const item = filtered[selectedIndex];
  const key = item.category + '/' + item.name;
  const status = results[key];
  const emoji = EMOJI_MAP[item.category] || '';
  const regen = isRegenerating(key);

  const statusText = !status ? '' : (status === 'pass' ? '✅ Pass' : '❌ Fail');
  const statusClass = !status ? '' : status;

  const variants = [
    { suffix: 'object', label: 'Object', checker: true },
    { suffix: 'scene', label: 'Scene', checker: false },
    { suffix: 'background', label: 'Background', checker: false },
  ];

  // 재생성 중이거나 최근 완료된 아이템은 캐시 버스팅
  const itemKey = `${item.category}/${item.name}`;
  const regenState = regenItems[itemKey];
  const cacheBust = regenState ? `?t=${regenState.updatedAt || Date.now()}` : '';

  const imagesHtml = variants.map(v => {
    const src = `/images/${item.category}/${item.name}-${v.suffix}.png${cacheBust}`;
    return `<div class="item-img-wrapper${v.checker ? ' checkerboard' : ''}">
      <a href="${src.split('?')[0]}" target="_blank"><img src="${src}" alt="${item.name} ${v.label}"></a>
      <div class="item-img-label">${v.label}</div>
    </div>`;
  }).join('');

  const compositeSrc = `/composite/${item.category}/${item.name}${cacheBust}`;
  const compositeHtml = `<div class="item-img-wrapper">
    <a href="${compositeSrc.split('?')[0]}" target="_blank"><img src="${compositeSrc}" alt="${item.name} Composite"></a>
    <div class="item-img-label">합성</div>
  </div>`;

  // Regen status display in item view
  let regenStatusHtml = '';
  if (regen) {
    const ri = regenItems[key];
    const step = ri.step || '대기 중';
    regenStatusHtml = `<div class="item-regen-status">
      <span class="spinner"></span> <span>🔄 재생성 중: ${step}</span>
    </div>`;
  }

  container.innerHTML = `
    <div class="item-title">
      ${emoji} ${item.name} <span class="item-category">— ${item.category}</span>
      ${statusText ? `<span class="status-badge ${statusClass}">${statusText}</span>` : ''}
      ${regen ? '<span class="status-badge regen">🔄 재생성 중</span>' : ''}
    </div>
    <div class="item-images">${imagesHtml}${compositeHtml}</div>
    <div class="item-actions">
      <button class="btn-pass-lg" onclick="doReview(selectedIndex, 'pass')">✅ PASS</button>
      <button class="btn-fail-lg" onclick="doReview(selectedIndex, 'fail')">❌ FAIL</button>
    </div>
    <div class="item-regen-section" id="item-regen-section">
      <div class="regen-comment-row">
        <div class="regen-comment-group">
          <label class="regen-comment-label">📦 오브젝트</label>
          <textarea id="regen-comment-obj" class="regen-comment" placeholder="예: 잎 없애줘, 좀 더 노랗게..." rows="2"></textarea>
        </div>
        <div class="regen-comment-group">
          <label class="regen-comment-label">🌄 배경</label>
          <textarea id="regen-comment-bg" class="regen-comment" placeholder="예: 실내 배경으로, 배경이 너무 어두워..." rows="2"></textarea>
        </div>
      </div>
      <button class="btn-regen-item" onclick="regenCurrentItem()" id="btn-regen-item" ${regen ? 'disabled' : ''}>🔄 이 아이템 재생성</button>
      ${regenStatusHtml}
    </div>
    <div class="item-nav">
      <button class="nav-btn" onclick="navigate(-1)" ${selectedIndex === 0 ? 'disabled' : ''}>&larr; Prev</button>
      <div class="item-progress">
        <span>${selectedIndex + 1} / ${filtered.length}</span>
        <div class="item-progress-bar">
          <div class="item-progress-fill" style="width:${(selectedIndex + 1) / filtered.length * 100}%"></div>
        </div>
      </div>
      <button class="nav-btn" onclick="navigate(1)" ${selectedIndex === filtered.length - 1 ? 'disabled' : ''}>Next &rarr;</button>
    </div>
    <div id="regen-log-section" class="regen-log-section" style="display:none"></div>`;

  loadRegenLog(item.category, item.name);
}

function navigate(dir) {
  const filtered = getFilteredItems();
  const next = selectedIndex + dir;
  if (next >= 0 && next < filtered.length) {
    selectedIndex = next;
    render();
  }
}

// ── Grid View ──

function renderGridView() {
  const filtered = getFilteredItems();
  const grid = document.getElementById('grid-view');
  grid.innerHTML = '';

  if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);

  let lastCategory = '';
  filtered.forEach((item, idx) => {
    if (item.category !== lastCategory) {
      lastCategory = item.category;
      const label = document.createElement('div');
      label.className = 'category-label';
      label.textContent = item.category;
      grid.appendChild(label);
    }

    const key = item.category + '/' + item.name;
    const status = results[key];
    const regen = isRegenerating(key);
    const card = document.createElement('div');
    card.className = 'card' + (idx === selectedIndex ? ' selected' : '') +
      (status ? ' status-' + status : '');
    card.dataset.index = idx;
    card.onclick = () => { selectedIndex = idx; render(); };

    const statusText = !status ? '미리뷰 없음' : (status === 'pass' ? '합격' : '불합격');
    const statusClass = !status ? 'unreviewed' : status;

    const variants = [
      { suffix: 'object', label: 'Object', checker: true },
      { suffix: 'scene', label: 'Scene', checker: false },
      { suffix: 'background', label: 'Background', checker: false },
    ];

    const imagesHtml = variants.map(v => {
      const src = `/images/${item.category}/${item.name}-${v.suffix}.png`;
      return `<div class="img-wrapper${v.checker ? ' checkerboard' : ''}">
        <a href="${src}" target="_blank"><img src="${src}" loading="lazy" alt="${item.name} ${v.label}"></a>
        <div class="img-label">${v.label}</div>
      </div>`;
    }).join('');

    const gridCompositeSrc = `/composite/${item.category}/${item.name}`;
    const gridCompositeHtml = `<div class="img-wrapper">
      <a href="${gridCompositeSrc}" target="_blank"><img src="${gridCompositeSrc}" loading="lazy" alt="${item.name} Composite"></a>
      <div class="img-label">합성</div>
    </div>`;

    card.innerHTML = `
      <div class="card-header">
        <span class="item-name">${regen ? '🔄 ' : ''}${item.name}</span>
        <span class="status-badge ${statusClass}">${statusText}</span>
      </div>
      <div class="images">${imagesHtml}${gridCompositeHtml}</div>
      <div class="actions">
        <button class="btn-pass" onclick="event.stopPropagation(); doReview(${idx}, 'pass')">PASS</button>
        <button class="btn-fail" onclick="event.stopPropagation(); doReview(${idx}, 'fail')">FAIL</button>
      </div>`;

    grid.appendChild(card);
  });
}

// ── Shared ──

function doReview(idx, status) {
  const filtered = getFilteredItems();
  const item = filtered[idx];
  if (!item) return;
  const key = item.category + '/' + item.name;
  results[key] = status;

  fetch('/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: item.name, category: item.category, status })
  });

  render();
  loadFailedItems();
}

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const filtered = getFilteredItems();
  if (e.key === 'ArrowRight') {
    selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
    render();
    if (currentTab === 'grid') scrollToSelected();
  } else if (e.key === 'ArrowLeft') {
    selectedIndex = Math.max(selectedIndex - 1, 0);
    render();
    if (currentTab === 'grid') scrollToSelected();
  } else if (e.key === 'p') {
    doReview(selectedIndex, 'pass');
  } else if (e.key === 'f') {
    doReview(selectedIndex, 'fail');
  }
});

function scrollToSelected() {
  const el = document.querySelector('.card.selected');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setFilter(mode) { filterMode = mode; selectedIndex = 0; render(); }
function setCategory(cat) { categoryFilter = cat; selectedIndex = 0; render(); }

// ── Regeneration (Non-blocking) ──

function regenCurrentItem() {
  const filtered = getFilteredItems();
  const item = filtered[selectedIndex];
  if (!item) return;
  const key = item.category + '/' + item.name;

  if (isRegenerating(key)) return;

  const objComment = (document.getElementById('regen-comment-obj')?.value || '').trim();
  const bgComment = (document.getElementById('regen-comment-bg')?.value || '').trim();

  // Register in regenItems immediately
  regenItems[key] = { status: 'pending', step: '요청 중...', jobId: null };
  render();
  renderFloatingPanel();

  fetch('/regenerate_single', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({category: item.category, item: item.name, obj_comment: objComment, bg_comment: bgComment})
  })
  .then(r => r.json())
  .then(data => {
    if (data.error) {
      regenItems[key] = { status: 'failed', error: data.error };
      scheduleRemoveFromPanel(key);
      render();
      renderFloatingPanel();
      return;
    }
    regenItems[key].jobId = data.job_id;
    activeJobIds.add(data.job_id);
    ensurePolling();
  });
}

function regenSingle(category, item) {
  const key = category + '/' + item;
  if (isRegenerating(key)) return;

  regenItems[key] = { status: 'pending', step: '요청 중...', jobId: null };
  renderFloatingPanel();
  render();

  startRegen([{category, item}]);
}

function regenAll() {
  fetch('/failed_items')
    .then(r => r.json())
    .then(items => {
      if (items.length === 0) return;
      // Mark all as pending
      items.forEach(fi => {
        const key = fi.category + '/' + fi.item;
        if (!isRegenerating(key)) {
          regenItems[key] = { status: 'pending', step: '요청 중...', jobId: null };
        }
      });
      renderFloatingPanel();
      render();
      startRegen(items);
    });
}

function startRegen(itemsList) {
  fetch('/regenerate', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({items: itemsList})
  })
  .then(r => r.json())
  .then(data => {
    if (data.error) {
      itemsList.forEach(fi => {
        const key = fi.category + '/' + fi.item;
        regenItems[key] = { status: 'failed', error: data.error };
        scheduleRemoveFromPanel(key);
      });
      renderFloatingPanel();
      return;
    }
    const jobId = data.job_id;
    activeJobIds.add(jobId);
    itemsList.forEach(fi => {
      const key = fi.category + '/' + fi.item;
      if (regenItems[key]) regenItems[key].jobId = jobId;
    });
    ensurePolling();
  });
}

// ── Global Polling ──

function ensurePolling() {
  if (!regenPollingInterval) {
    regenPollingInterval = setInterval(pollAllJobs, 2000);
    pollAllJobs();
  }
}

function startGlobalPolling() {
  // Check if there are active jobs on page load
  fetch('/regen_active')
    .then(r => r.json())
    .then(activeJobs => {
      for (const [jobId, job] of Object.entries(activeJobs)) {
        activeJobIds.add(jobId);
        for (const [key, st] of Object.entries(job.items)) {
          regenItems[key] = { ...st, jobId };
        }
      }
      if (activeJobIds.size > 0) {
        ensurePolling();
        renderFloatingPanel();
        render();
      }
    });
}

function pollAllJobs() {
  if (activeJobIds.size === 0) {
    clearInterval(regenPollingInterval);
    regenPollingInterval = null;
    return;
  }

  const promises = [...activeJobIds].map(jobId =>
    fetch(`/regen_status/${jobId}`)
      .then(r => r.json())
      .then(job => ({ jobId, job }))
      .catch(() => null)
  );

  Promise.all(promises).then(results_arr => {
    let anyChange = false;
    const currentItem = getCurrentViewItem();

    results_arr.forEach(entry => {
      if (!entry || entry.job.error) return;
      const { jobId, job } = entry;

      for (const [key, st] of Object.entries(job.items)) {
        const nowDone = st.status === 'done' || st.status === 'failed';

        // Check for newly completed steps before overwriting
        const prev = regenItems[key];
        const prevSteps = (prev && prev.completed_steps) || [];
        const curSteps = st.completed_steps || [];
        const newSteps = curSteps.filter(s => !prevSteps.includes(s));

        regenItems[key] = { ...st, jobId, updatedAt: newSteps.length > 0 ? Date.now() : (prev && prev.updatedAt) };

        // Refresh images for each newly completed step
        if (newSteps.length > 0) {
          const [cat, name] = key.split('/');
          newSteps.forEach(step => refreshImageForStep(step, { category: cat, name }));
          // 현재 아이템 뷰 헤더도 재렌더링 (캐시버스팅 반영)
          if (currentItem && key === currentItem.category + '/' + currentItem.name) {
            renderItemView();
          }
        }

        if (nowDone && !refreshedKeys.has(key)) {
          refreshedKeys.add(key);
          anyChange = true;
          regenItems[key].finishedAt = Date.now();
          scheduleRemoveFromPanel(key);

          // Refresh images for this item
          const [cat, name] = key.split('/');
          refreshImagesForKey(key, { category: cat, name });

          // Refresh regen log if currently viewed
          if (currentItem && key === currentItem.category + '/' + currentItem.name) {
            loadRegenLog(currentItem.category, currentItem.name);
          }
        }
      }

      // Check if job is fully complete
      const statuses = Object.values(job.items).map(v => v.status);
      if (!statuses.includes('pending') && !statuses.includes('running')) {
        activeJobIds.delete(jobId);
      }
    });

    renderFloatingPanel();
    if (anyChange) {
      loadFailedItems();
      render();
    }

    // Stop polling if no active jobs
    if (activeJobIds.size === 0) {
      clearInterval(regenPollingInterval);
      regenPollingInterval = null;
    }
  });
}

function getCurrentViewItem() {
  if (currentTab !== 'item') return null;
  const filtered = getFilteredItems();
  return filtered[selectedIndex] || null;
}

function refreshImagesForKey(key, item) {
  const ts = Date.now();
  const prefixes = [
    `/images/${item.category}/${item.name}-`,
    `/composite/${item.category}/${item.name}`
  ];
  document.querySelectorAll('img').forEach(img => {
    const src = img.src.split('?')[0];
    if (prefixes.some(p => src.includes(p))) {
      img.src = src + '?t=' + ts;
    }
  });
}

function refreshImageForStep(step, item) {
  const ts = Date.now();
  const stepFileMap = {
    object_raw: `-object-orig.png`,
    object: `-object.png`,
    scene: `-scene.png`,
    background: `-background.png`,
  };
  const suffix = stepFileMap[step];
  if (!suffix) return;

  const imgPath = `/images/${item.category}/${item.name}${suffix}`;
  document.querySelectorAll('img').forEach(img => {
    const src = img.src.split('?')[0];
    if (src.includes(imgPath)) {
      img.src = src + '?t=' + ts;
    }
  });

  // When background completes, also refresh composite
  if (step === 'background') {
    const compositePath = `/composite/${item.category}/${item.name}`;
    document.querySelectorAll('img').forEach(img => {
      const src = img.src.split('?')[0];
      if (src.includes(compositePath)) {
        img.src = src + '?t=' + ts;
      }
    });
  }
}

function refreshImages() {
  const ts = Date.now();
  document.querySelectorAll('img[src^="/images/"], img[src^="/composite/"]').forEach(img => {
    const src = img.src.split('?')[0];
    img.src = src + '?t=' + ts;
  });
}

// ── Regen Log ──

function loadRegenLog(category, item) {
  const section = document.getElementById('regen-log-section');
  if (!section) return;

  fetch(`/regen_log/${category}/${item}`)
    .then(r => {
      if (!r.ok) throw new Error('not found');
      return r.json();
    })
    .then(log => {
      section.style.display = '';
      const ts = log.timestamp ? new Date(log.timestamp).toLocaleString('ko-KR') : '알 수 없음';
      const response = log.response || '(응답 없음)';
      const request = log.request || '(요청 없음)';
      section.innerHTML = `
        <div class="regen-log-title">📋 마지막 생성 로그</div>
        <div class="regen-log-row">🕐 <span class="regen-log-label">시간:</span> ${ts}</div>
        <div class="regen-log-row">💬 <span class="regen-log-label">LLM 응답:</span></div>
        <div class="regen-log-content">${escapeHtml(response)}</div>
        <details class="regen-log-details">
          <summary>📝 요청 프롬프트</summary>
          <div class="regen-log-content">${escapeHtml(request)}</div>
        </details>`;
    })
    .catch(() => {
      section.style.display = 'none';
    });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Floating Panel ──

function scheduleRemoveFromPanel(key) {
  setTimeout(() => {
    const ri = regenItems[key];
    if (ri && (ri.status === 'done' || ri.status === 'failed')) {
      delete regenItems[key];
      refreshedKeys.delete(key);
      renderFloatingPanel();
    }
  }, 5000);
}

function renderFloatingPanel() {
  const panel = document.getElementById('floating-regen-panel');
  const panelItems = Object.entries(regenItems);

  if (panelItems.length === 0) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = '';

  const listHtml = panelItems.map(([key, ri]) => {
    const name = key.split('/')[1];
    let icon, statusText, cls;
    if (ri.status === 'pending') {
      icon = '⏳'; statusText = '대기 중'; cls = 'pending';
    } else if (ri.status === 'running') {
      icon = '<span class="spinner"></span>'; statusText = ri.step || '생성 중'; cls = 'running';
    } else if (ri.status === 'done') {
      icon = '✅'; statusText = '완료'; cls = 'done';
    } else {
      icon = '❌'; statusText = '실패'; cls = 'failed';
    }
    return `<div class="fp-item ${cls}">
      <span class="fp-icon">${icon}</span>
      <span class="fp-name">${name}</span>
      <span class="fp-status">${statusText}</span>
    </div>`;
  }).join('');

  document.getElementById('fp-list').innerHTML = listHtml;
}

// ── Failed Items Section ──

function loadFailedItems() {
  fetch('/failed_items')
    .then(r => r.json())
    .then(failedItems => {
      const section = document.getElementById('regen-section');
      const list = document.getElementById('failed-list');

      if (failedItems.length === 0) {
        section.style.display = 'none';
        return;
      }

      section.style.display = '';
      list.innerHTML = failedItems.map(fi => {
        const key = fi.category + '/' + fi.item;
        const regen = isRegenerating(key);
        let statusHtml = '';
        if (regen) {
          const ri = regenItems[key];
          const step = ri.step || 'queued';
          statusHtml = `<span class="regen-item-status running"><span class="spinner"></span> ${step}</span>`;
        }
        return `<div class="failed-item" data-key="${key}">
          <span class="failed-item-name">${regen ? '🔄 ' : ''}${fi.item}</span>
          <span class="failed-item-cat">${fi.category}</span>
          ${statusHtml}
          <button class="btn-regen-single" onclick="regenSingle('${fi.category}', '${fi.item}')"
            ${regen ? 'disabled' : ''}>재생성</button>
        </div>`;
      }).join('');
    });
}
