const SUPABASE_URL = "https://ecwdxhcxyuutyxzjjhbi.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_DOqW6Lf_dk5E19SUwIRkiA_fjAkD0Gf";

const supabaseClient = (SUPABASE_URL && !SUPABASE_URL.includes("YOUR_SUPABASE")) 
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) 
    : null;

let GRID_SIZE = 150;
const TOTAL_LEVELS = 10000;
const TARGET_COLORS_COUNT = 160;

let settings = {
    showProgress: true,
    showRemaining: true,
    showTime: true,
    showPalette: true,
    showMinimap: true,
    autoTimelapse: true
};

let activeTheme = 'all';
let currentUser = null;
let currentCategory = 'mandala';
let currentLevel = 0;
let activeColorId = 1;
let customImageUrl = "";
let isLevelLoaded = false;
let realtimeChannel = null;

let isPanMode = false;
let colorPalette = [];
let rgbPaletteParsed = [];
let answerGrid = new Uint8Array(GRID_SIZE * GRID_SIZE);
let userGrid = new Uint8Array(GRID_SIZE * GRID_SIZE);

let moveHistory = [];
let timerInterval = null;
let secondsElapsed = 0;
let isTimelapsePlaying = false;
let timelapseInterval = null;
let levelAlreadyCompleted = false;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimapCanvas');
const mCtx = minimapCanvas.getContext('2d');

let viewTransform = { x: 0, y: 0, zoom: 1 };

let activePointers = new Map();
let initialPinchDist = null;
let initialZoom = 1;
let isDragging = false;
let isPanning = false;
let lastPointerPos = { x: 0, y: 0 };
let saveTimeout = null;

let hintMarker = null;
let hintAnimFrame = null;

function loadSettings() {
    const saved = localStorage.getItem('studio_settings');
    if (saved) {
        try { settings = { ...settings, ...JSON.parse(saved) }; } catch(e){}
    }
    applySettingsUI();
}

function saveSettings() {
    localStorage.setItem('studio_settings', JSON.stringify(settings));
    applySettingsUI();
}

function updateSetting(key, val) {
    settings[key] = val;
    saveSettings();
}

function applySettingsUI() {
    document.getElementById('set-progress').checked = settings.showProgress;
    document.getElementById('set-remaining').checked = settings.showRemaining;
    document.getElementById('set-time').checked = settings.showTime;
    document.getElementById('set-palette').checked = settings.showPalette;
    document.getElementById('set-minimap').checked = settings.showMinimap;
    document.getElementById('set-timelapse').checked = settings.autoTimelapse;

    document.getElementById('dash-pct-container').style.display = settings.showProgress ? 'block' : 'none';
    document.getElementById('dash-left-container').style.display = settings.showRemaining ? 'block' : 'none';
    document.getElementById('dash-time-container').style.display = settings.showTime ? 'block' : 'none';

    const dashBar = document.getElementById('dashboard-bar');
    dashBar.style.display = (!settings.showProgress && !settings.showRemaining && !settings.showTime) ? 'none' : 'flex';

    const paletteWrapper = document.getElementById('palette-wrapper');
    const paletteTab = document.getElementById('palette-tab');
    
    paletteWrapper.style.display = 'block';
    if (settings.showPalette) {
        paletteTab.style.display = 'block';
    } else {
        paletteTab.style.display = 'none';
        paletteWrapper.classList.remove('hidden');
    }

    const minimapOverlay = document.getElementById('minimap-overlay');
    minimapOverlay.style.display = settings.showMinimap ? 'block' : 'none';

    resizeCanvas();
    draw();
}

function toggleSettingsModal(show) {
    document.getElementById('settings-modal').classList.toggle('active', show);
}

async function updateGridDimensions(val) {
    if (isLevelLoaded) {
        await saveState(true);
    }
    GRID_SIZE = parseInt(val, 10);
    answerGrid = new Uint8Array(GRID_SIZE * GRID_SIZE);
    userGrid = new Uint8Array(GRID_SIZE * GRID_SIZE);
    if (isLevelLoaded) {
        await initLevel(currentLevel);
    } else {
        await renderPortfolioGallery();
    }
}

function getStorageKey(category, levelIndex) {
    const userId = currentUser ? currentUser.id : 'guest';
    return `grid_save_${userId}_${category}_${levelIndex}_${GRID_SIZE}`;
}

function getLevelTheme(levelIdx) {
    const themeKeys = ['warm', 'cool', 'pastel', 'neon', 'grayscale'];
    return themeKeys[levelIdx % themeKeys.length];
}

function changeTheme(themeKey) {
    activeTheme = themeKey;
    renderPortfolioGallery();
}

function startDashboardTimer() {
    clearInterval(timerInterval);
    secondsElapsed = 0;
    timerInterval = setInterval(() => {
        secondsElapsed++;
        updateDashboard();
    }, 1000);
    updateDashboard();
}

function updateDashboard() {
    let filled = 0;
    const total = GRID_SIZE * GRID_SIZE;
    for (let i = 0; i < total; i++) {
        if (userGrid[i] !== 0) filled++;
    }
    const pct = ((filled / total) * 100).toFixed(1);
    const remaining = total - filled;
    
    const mins = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
    const secs = (secondsElapsed % 60).toString().padStart(2, '0');

    document.getElementById('dash-pct').textContent = `${pct}%`;
    document.getElementById('dash-left').textContent = remaining;
    document.getElementById('dash-time').textContent = `${mins}:${secs}`;
}

function checkLevelCompletion() {
    if (levelAlreadyCompleted || isTimelapsePlaying) return;

    let filled = 0;
    const total = GRID_SIZE * GRID_SIZE;
    for (let i = 0; i < total; i++) {
        if (userGrid[i] !== 0) filled++;
    }

    if (filled === total) {
        levelAlreadyCompleted = true;
        clearInterval(timerInterval);
        if (settings.autoTimelapse) {
            setTimeout(() => {
                playTimelapse();
            }, 300);
        }
    }
}

function togglePalette() {
    if (!settings.showPalette) return;
    const wrapper = document.getElementById('palette-wrapper');
    const tab = document.getElementById('palette-tab');
    const isHidden = wrapper.classList.toggle('hidden');
    if (tab) tab.textContent = isHidden ? 'SHOW PALETTE' : 'HIDE PALETTE';
    resizeCanvas();
    draw();
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

function triggerHint() {
    if (!isLevelLoaded || isTimelapsePlaying) return;
    let targetIdx = -1;

    for (let i = 0; i < answerGrid.length; i++) {
        if (userGrid[i] === 0 && answerGrid[i] === activeColorId) {
            targetIdx = i;
            break;
        }
    }

    if (targetIdx === -1) {
        for (let i = 0; i < answerGrid.length; i++) {
            if (userGrid[i] === 0) {
                targetIdx = i;
                activeColorId = answerGrid[i];
                generatePaletteUI();
                break;
            }
        }
    }

    if (targetIdx === -1) return;

    const gx = targetIdx % GRID_SIZE;
    const gy = Math.floor(targetIdx / GRID_SIZE);

    viewTransform.zoom = 12;
    viewTransform.x = (canvas.width / 2) - (gx + 0.5) * viewTransform.zoom;
    viewTransform.y = (canvas.height / 2) - (gy + 0.5) * viewTransform.zoom;

    hintMarker = {
        x: gx + 0.5,
        y: gy + 0.5,
        startTime: performance.now(),
        duration: 1800
    };

    if (hintAnimFrame) cancelAnimationFrame(hintAnimFrame);
    animateHint();
}

function animateHint() {
    if (!hintMarker) return;
    const elapsed = performance.now() - hintMarker.startTime;
    if (elapsed > hintMarker.duration) {
        hintMarker = null;
        draw();
        return;
    }
    draw();
    hintAnimFrame = requestAnimationFrame(animateHint);
}

function playTimelapse() {
    if (isTimelapsePlaying) {
        skipTimelapse();
        return;
    }
    if (moveHistory.length === 0) return;

    isTimelapsePlaying = true;
    const tempGrid = new Uint8Array(userGrid);
    userGrid.fill(0);

    let step = 0;
    const speed = Math.max(1, Math.floor(moveHistory.length / 150));

    timelapseInterval = setInterval(() => {
        for (let i = 0; i < speed && step < moveHistory.length; i++) {
            const idx = moveHistory[step];
            userGrid[idx] = answerGrid[idx];
            step++;
        }
        draw();

        if (step >= moveHistory.length) {
            clearInterval(timelapseInterval);
            userGrid.set(tempGrid);
            isTimelapsePlaying = false;
            draw();
        }
    }, 16);
}

function skipTimelapse() {
    if (timelapseInterval) clearInterval(timelapseInterval);
    for (let idx of moveHistory) {
        userGrid[idx] = answerGrid[idx];
    }
    isTimelapsePlaying = false;
    draw();
}

function setupRealtimeSubscription() {
    if (!supabaseClient || !currentUser) return;
    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);

    realtimeChannel = supabaseClient
        .channel('public:user_progress')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'user_progress',
            filter: `user_id=eq.${currentUser.id}`
        }, (payload) => {
            const newRow = payload.new;
            if (newRow && newRow.category === currentCategory && newRow.level_index === currentLevel && isLevelLoaded && !isTimelapsePlaying) {
                const indices = newRow.colored_indices || [];
                for (let idx of indices) {
                    if (idx < userGrid.length) {
                        userGrid[idx] = answerGrid[idx];
                    }
                }
                generatePaletteUI();
                updateDashboard();
                checkLevelCompletion();
                draw();
            }
        })
        .subscribe();
}

async function initAuthSession() {
    if (!supabaseClient) {
        bypassAuth();
        return;
    }
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        currentUser = session.user;
        document.getElementById('auth-overlay').classList.remove('active');
        document.getElementById('user-status').textContent = currentUser.email;
        setupRealtimeSubscription();
    } else {
        bypassAuth();
    }
    await renderPortfolioGallery();

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
        const prevUserId = currentUser ? currentUser.id : null;
        currentUser = session ? session.user : null;
        const newUserId = currentUser ? currentUser.id : null;
        
        document.getElementById('user-status').textContent = currentUser ? currentUser.email : 'Offline Mode';
        if (currentUser) {
            document.getElementById('auth-overlay').classList.remove('active');
        }
        
        if (prevUserId !== newUserId) {
            if (currentUser) setupRealtimeSubscription();
            if (isLevelLoaded) {
                await initLevel(currentLevel);
            } else {
                await renderPortfolioGallery();
            }
        }
    });
}

async function handleAuth(type) {
    if (!supabaseClient) return bypassAuth();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    
    const { data, error } = type === 'login' 
        ? await supabaseClient.auth.signInWithPassword({ email, password })
        : await supabaseClient.auth.signUp({ email, password });

    if (error) {
        alert(error.message);
    } else {
        currentUser = data.user;
        document.getElementById('auth-overlay').classList.remove('active');
        document.getElementById('user-status').textContent = currentUser.email;
        setupRealtimeSubscription();
        await renderPortfolioGallery();
    }
}

function bypassAuth() {
    currentUser = null;
    document.getElementById('auth-overlay').classList.remove('active');
    document.getElementById('user-status').textContent = 'Offline Mode';
    renderPortfolioGallery();
}

function switchCategory(category) {
    currentCategory = category;
    renderCategoryTabs();
    document.getElementById('custom-url-container').classList.toggle('active', category === 'custom');
    renderPortfolioGallery();
}

function renderCategoryTabs() {
    const tabsContainer = document.getElementById('category-tabs');
    tabsContainer.innerHTML = `
        <button class="tab-btn ${currentCategory === 'mandala' ? 'active' : ''}" onclick="switchCategory('mandala')">Mandalas</button>
        <button class="tab-btn ${currentCategory === 'photography' ? 'active' : ''}" onclick="switchCategory('photography')">Photography</button>
        <button class="tab-btn ${currentCategory === 'custom' ? 'active' : ''}" onclick="switchCategory('custom')">Custom URL</button>
    `;
}

function toggleInteractionMode() {
    isPanMode = !isPanMode;
    const btn = document.getElementById('mode-toggle');
    btn.textContent = isPanMode ? "Mode: PAN" : "Mode: PAINT";
    btn.classList.toggle('active', isPanMode);
}

async function initLevel(levelIndex, overrideUrl = null) {
    isLevelLoaded = false;
    levelAlreadyCompleted = false;
    hintMarker = null;
    moveHistory = [];
    currentLevel = levelIndex;
    document.getElementById('level-title').textContent = `${currentCategory.toUpperCase()} #${currentLevel + 1} (${GRID_SIZE}x${GRID_SIZE})`;
    
    answerGrid = new Uint8Array(GRID_SIZE * GRID_SIZE);
    userGrid = new Uint8Array(GRID_SIZE * GRID_SIZE);

    try {
        if (currentCategory === 'photography') {
            const subject = document.getElementById('subject-select').value;
            const seedTag = subject === 'general' ? currentLevel : `${subject}-${currentLevel}`;
            await loadPhotoFromUrl(`https://picsum.photos/seed/${seedTag}/${GRID_SIZE}/${GRID_SIZE}`);
        } else if (currentCategory === 'custom') {
            const userId = currentUser ? currentUser.id : 'guest';
            let url = overrideUrl;
            
            if (!url && currentUser && supabaseClient) {
                const { data } = await supabaseClient.from('user_progress')
                    .select('custom_url')
                    .eq('user_id', currentUser.id)
                    .eq('category', 'custom')
                    .eq('level_index', currentLevel)
                    .maybeSingle();
                if (data && data.custom_url) url = data.custom_url;
            }
            
            if (!url) {
                url = localStorage.getItem(`custom_url_${userId}_${currentLevel}`);
            }
            
            if (!url) {
                alert(`No custom image URL provided for Level #${currentLevel + 1}`);
                returnToGallery();
                return;
            }

            customImageUrl = url;
            localStorage.setItem(`custom_url_${userId}_${currentLevel}`, url);
            await loadPhotoFromUrl(url);
        } else {
            generateDeterministicData(currentLevel);
        }
    } catch(err) {
        alert("Image loading failed. Ensure URL supports cross-origin sharing (CORS).");
        returnToGallery();
        return;
    }

    await loadState();
    isLevelLoaded = true;
    resizeCanvas();
    resetViewport();
    generatePaletteUI();
    startDashboardTimer();
    applySettingsUI();
}

async function loadPhotoFromUrl(url) {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = url;

    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("Failed to load image. CORS restriction active."));
    });

    const offCanvas = document.createElement('canvas');
    offCanvas.width = GRID_SIZE;
    offCanvas.height = GRID_SIZE;
    const offCtx = offCanvas.getContext('2d');
    offCtx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE);

    const imgData = offCtx.getImageData(0, 0, GRID_SIZE, GRID_SIZE).data;

    colorPalette = ['#e0e0e0'];
    rgbPaletteParsed = [[224, 224, 224]];
    const colorMap = new Map();

    for (let i = 0; i < imgData.length; i += 4) {
        if (imgData[i + 3] < 128) continue;
        const r = Math.round(imgData[i] / 16) * 16;
        const g = Math.round(imgData[i + 1] / 16) * 16;
        const b = Math.round(imgData[i + 2] / 16) * 16;
        const key = `${r},${g},${b}`;
        colorMap.set(key, (colorMap.get(key) || 0) + 1);
    }

    const sortedColors = Array.from(colorMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, TARGET_COLORS_COUNT);

    sortedColors.forEach(([rgbStr]) => {
        const [r, g, b] = rgbStr.split(',').map(Number);
        colorPalette.push(`rgb(${r},${g},${b})`);
        rgbPaletteParsed.push([r, g, b]);
    });

    userGrid.fill(0);
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const pIdx = (y * GRID_SIZE + x) * 4;
            const r = imgData[pIdx];
            const g = imgData[pIdx + 1];
            const b = imgData[pIdx + 2];

            let closestIdx = 1;
            let minDist = Infinity;
            for (let i = 1; i < rgbPaletteParsed.length; i++) {
                const [pr, pg, pb] = rgbPaletteParsed[i];
                const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
                if (dist < minDist) {
                    minDist = dist;
                    closestIdx = i;
                }
            }
            answerGrid[y * GRID_SIZE + x] = closestIdx;
        }
    }
}

function loadCustomUrlFromInput() {
    const input = document.getElementById('custom-image-url');
    if (!input.value) return;
    const targetUrl = input.value;
    input.value = '';
    document.getElementById('home-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    initLevel(currentLevel, targetUrl);
}

function generateDeterministicData(seed) {
    let currentSeed = (seed + 1) * 123456789;
    function nextRandom() {
        currentSeed = (currentSeed * 1664525 + 1013904223) % 4294967296;
        return currentSeed / 4294967296;
    }

    colorPalette = ['#e0e0e0'];
    rgbPaletteParsed = [[224, 224, 224]];

    for (let i = 1; i <= TARGET_COLORS_COUNT; i++) {
        const r = Math.floor(nextRandom() * 190) + 40;
        const g = Math.floor(nextRandom() * 190) + 40;
        const b = Math.floor(nextRandom() * 190) + 40;
        colorPalette.push(`rgb(${r},${g},${b})`);
        rgbPaletteParsed.push([r, g, b]);
    }

    const centerX = GRID_SIZE / 2;
    const centerY = GRID_SIZE / 2;
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            let dx = x - centerX, dy = y - centerY;
            let r = Math.sqrt(dx * dx + dy * dy);
            let angle = Math.atan2(dy, dx);
            let val = (Math.sin(r * 0.8) + Math.cos(angle * 12) + 2) / 4;
            answerGrid[y * GRID_SIZE + x] = Math.floor(val * (TARGET_COLORS_COUNT - 1)) + 1;
        }
    }
    userGrid.fill(0);
}

function drawMinimap() {
    if (!settings.showMinimap || !document.getElementById('game-screen').classList.contains('active')) return;
    
    mCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    const ratio = 140 / GRID_SIZE;

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const idx = y * GRID_SIZE + x;
            const uColor = userGrid[idx];
            if (uColor !== 0) {
                mCtx.fillStyle = colorPalette[uColor];
            } else {
                mCtx.fillStyle = '#222222';
            }
            mCtx.fillRect(x * ratio, y * ratio, Math.max(1, ratio), Math.max(1, ratio));
        }
    }

    const vX = -viewTransform.x / viewTransform.zoom;
    const vY = -viewTransform.y / viewTransform.zoom;
    const vW = (canvas.width / (window.devicePixelRatio || 1)) / viewTransform.zoom;
    const vH = (canvas.height / (window.devicePixelRatio || 1)) / viewTransform.zoom;

    mCtx.strokeStyle = '#00adb5';
    mCtx.lineWidth = 1.5;
    mCtx.strokeRect(vX * ratio, vY * ratio, vW * ratio, vH * ratio);
}

function draw() {
    if (!canvas.width) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(viewTransform.x, viewTransform.y);
    ctx.scale(viewTransform.zoom, viewTransform.zoom);

    const z = viewTransform.zoom;
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const idx = y * GRID_SIZE + x;
            const uColor = userGrid[idx];
            const aColor = answerGrid[idx];

            if (uColor !== 0) {
                ctx.fillStyle = colorPalette[uColor];
                ctx.fillRect(x, y, 1.05, 1.05);
            } else if (z > 4) {
                ctx.fillStyle = (aColor === activeColorId) ? '#b0b0b0' : '#ffffff';
                ctx.fillRect(x, y, 1.05, 1.05);
                ctx.strokeStyle = '#ddd';
                ctx.lineWidth = 1 / z;
                ctx.strokeRect(x, y, 1, 1);
                ctx.fillStyle = '#666';
                ctx.font = '0.4px system-ui';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(aColor, x + 0.5, y + 0.5);
            } else {
                ctx.fillStyle = '#fff';
                ctx.fillRect(x, y, 1.05, 1.05);
            }
        }
    }

    if (hintMarker) {
        const elapsed = performance.now() - hintMarker.startTime;
        const progress = elapsed / hintMarker.duration;
        const radius = 0.5 + (progress * 3.5);
        const alpha = Math.max(0, 1 - progress);

        ctx.save();
        
        ctx.beginPath();
        ctx.arc(hintMarker.x, hintMarker.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(231, 76, 60, ${alpha})`;
        ctx.lineWidth = 3 / z;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(hintMarker.x, hintMarker.y, radius * 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(241, 196, 15, ${alpha * 0.7})`;
        ctx.lineWidth = 2 / z;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(hintMarker.x, hintMarker.y, 0.25, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(231, 76, 60, ${alpha})`;
        ctx.fill();

        ctx.restore();
    }

    ctx.restore();
    drawMinimap();
}

minimapCanvas.addEventListener('pointerdown', (e) => {
    const rect = minimapCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const ratio = 140 / GRID_SIZE;
    const targetGX = mx / ratio;
    const targetGY = my / ratio;

    const logicalW = canvas.width / (window.devicePixelRatio || 1);
    const logicalH = canvas.height / (window.devicePixelRatio || 1);

    viewTransform.x = (logicalW / 2) - targetGX * viewTransform.zoom;
    viewTransform.y = (logicalH / 2) - targetGY * viewTransform.zoom;
    draw();
});

function getGridCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: Math.floor((clientX - rect.left - viewTransform.x) / viewTransform.zoom),
        y: Math.floor((clientY - rect.top - viewTransform.y) / viewTransform.zoom)
    };
}

canvas.addEventListener('pointerdown', (e) => {
    if (isTimelapsePlaying) {
        skipTimelapse();
        return;
    }
    canvas.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2) {
        isDragging = false;
        isPanning = false;
        const p = Array.from(activePointers.values());
        initialPinchDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        initialZoom = viewTransform.zoom;
        return;
    }

    lastPointerPos = { x: e.clientX, y: e.clientY };
    if (isPanMode || (e.pointerType === 'mouse' && e.button !== 0)) {
        isPanning = true;
        return;
    }
    
    const coords = getGridCoords(e.clientX, e.clientY);
    if (coords.x >= 0 && coords.x < GRID_SIZE && coords.y >= 0 && coords.y < GRID_SIZE) {
        const idx = coords.y * GRID_SIZE + coords.x;
        if (userGrid[idx] === 0 && answerGrid[idx] === activeColorId) {
            isDragging = true;
            userGrid[idx] = activeColorId;
            moveHistory.push(idx);
            saveState(false);
            generatePaletteUI();
            updateDashboard();
            draw();
            checkLevelCompletion();
        } else {
            isPanning = true;
        }
    }
});

canvas.addEventListener('pointermove', (e) => {
    if (isTimelapsePlaying || !activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2 && initialPinchDist) {
        const p = Array.from(activePointers.values());
        const currentDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        const factor = currentDist / initialPinchDist;
        const targetZoom = Math.min(Math.max(initialZoom * factor, 1), 50);

        const midX = (p[0].x + p[1].x) / 2;
        const midY = (p[0].y + p[1].y) / 2;
        const rect = canvas.getBoundingClientRect();

        const worldX = (midX - rect.left - viewTransform.x) / viewTransform.zoom;
        const worldY = (midY - rect.top - viewTransform.y) / viewTransform.zoom;

        viewTransform.x = (midX - rect.left) - worldX * targetZoom;
        viewTransform.y = (midY - rect.top) - worldY * targetZoom;
        viewTransform.zoom = targetZoom;
        draw();
        return;
    }

    if (isPanning) {
        viewTransform.x += e.clientX - lastPointerPos.x;
        viewTransform.y += e.clientY - lastPointerPos.y;
        draw();
    } else if (isDragging) {
        const coords = getGridCoords(e.clientX, e.clientY);
        if (coords.x >= 0 && coords.x < GRID_SIZE && coords.y >= 0 && coords.y < GRID_SIZE) {
            const idx = coords.y * GRID_SIZE + coords.x;
            if (userGrid[idx] === 0 && answerGrid[idx] === activeColorId) {
                userGrid[idx] = activeColorId;
                moveHistory.push(idx);
                saveState(false);
                generatePaletteUI();
                updateDashboard();
                draw();
                checkLevelCompletion();
            }
        }
    }
    lastPointerPos = { x: e.clientX, y: e.clientY };
});

const clearPointer = (e) => {
    if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
    }
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) initialPinchDist = null;
    if (activePointers.size === 0) { isDragging = false; isPanning = false; }
};

canvas.addEventListener('pointerup', clearPointer);
canvas.addEventListener('pointercancel', clearPointer);

canvas.addEventListener('wheel', (e) => {
    if (isTimelapsePlaying) return;
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const nextZoom = Math.min(Math.max(viewTransform.zoom * zoomFactor, 1), 50);
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldX = (mouseX - viewTransform.x) / viewTransform.zoom;
    const worldY = (mouseY - viewTransform.y) / viewTransform.zoom;

    viewTransform.zoom = nextZoom;
    viewTransform.x = mouseX - worldX * viewTransform.zoom;
    viewTransform.y = mouseY - worldY * viewTransform.zoom;
    draw();
}, { passive: false });

async function persistToCloud(coloredIndices) {
    if (!currentUser || !supabaseClient) return false;
    const payload = {
        user_id: currentUser.id,
        category: currentCategory,
        level_index: currentLevel,
        colored_indices: Array.from(coloredIndices)
    };
    if (currentCategory === 'custom' && customImageUrl) {
        payload.custom_url = customImageUrl;
    }
    
    const { error } = await supabaseClient
        .from('user_progress')
        .upsert(payload, { onConflict: 'user_id,category,level_index' });

    if (error) {
        console.error("Cloud persist failed:", error.message);
        return false;
    }
    return true;
}

async function saveState(immediate = false) {
    if (!isLevelLoaded) return;

    const coloredIndices = [];
    for (let i = 0; i < userGrid.length; i++) {
        if (userGrid[i] !== 0) coloredIndices.push(i);
    }
    const key = getStorageKey(currentCategory, currentLevel);
    localStorage.setItem(key, JSON.stringify(coloredIndices));

    if (currentUser && supabaseClient) {
        clearTimeout(saveTimeout);
        if (immediate) {
            return await persistToCloud(coloredIndices);
        } else {
            saveTimeout = setTimeout(() => persistToCloud(coloredIndices), 500);
        }
    }
}

async function loadState() {
    userGrid.fill(0);
    moveHistory = [];
    const key = getStorageKey(currentCategory, currentLevel);
    let coloredIndices = [];

    if (currentUser && supabaseClient) {
        const { data, error } = await supabaseClient.from('user_progress')
            .select('colored_indices, custom_url')
            .eq('user_id', currentUser.id)
            .eq('category', currentCategory)
            .eq('level_index', currentLevel)
            .maybeSingle();

        if (!error && data) {
            coloredIndices = data.colored_indices || [];
            if (data.custom_url) customImageUrl = data.custom_url;
            localStorage.setItem(key, JSON.stringify(coloredIndices));
        }
    }

    if (coloredIndices.length === 0) {
        const userId = currentUser ? currentUser.id : 'guest';
        const keyCandidates = [
            key,
            `grid_save_${userId}_${currentCategory}_${currentLevel}_${GRID_SIZE}`,
            `grid_save_guest_${currentCategory}_${currentLevel}_${GRID_SIZE}`
        ];

        for (const candidateKey of keyCandidates) {
            const raw = localStorage.getItem(candidateKey);
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed && parsed.length > 0) {
                        coloredIndices = parsed;
                        break;
                    }
                } catch(e) {}
            }
        }
    }

    for (let idx of coloredIndices) {
        if (idx < userGrid.length) {
            userGrid[idx] = answerGrid[idx];
            moveHistory.push(idx);
        }
    }

    if (coloredIndices.length >= GRID_SIZE * GRID_SIZE) {
        levelAlreadyCompleted = true;
    }
}

function resetViewport() {
    const logicalW = canvas.width / (window.devicePixelRatio || 1);
    const logicalH = canvas.height / (window.devicePixelRatio || 1);
    viewTransform.zoom = (Math.min(logicalW, logicalH) / GRID_SIZE) * 0.8;
    viewTransform.x = (logicalW - GRID_SIZE * viewTransform.zoom) / 2;
    viewTransform.y = (logicalH - GRID_SIZE * viewTransform.zoom) / 2;
}

function resizeCanvas() {
    const container = document.getElementById('main-layout');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    ctx.scale(dpr, dpr);
}

function generatePaletteUI() {
    const bar = document.getElementById('palette-bar');
    bar.innerHTML = '';

    const counts = new Map();
    for (let i = 0; i < answerGrid.length; i++) {
        const color = answerGrid[i];
        if (!counts.has(color)) counts.set(color, { total: 0, filled: 0 });
        const item = counts.get(color);
        item.total++;
        if (userGrid[i] !== 0) item.filled++;
    }

    let availableColors = [];
    for (let i = 1; i < colorPalette.length; i++) {
        const stats = counts.get(i) || { total: 0, filled: 0 };
        if (stats.total > 0 && stats.filled < stats.total) {
            availableColors.push(i);
        }
    }

    if (availableColors.length > 0 && !availableColors.includes(activeColorId)) {
        activeColorId = availableColors[0];
    }

    for (let i = 1; i < colorPalette.length; i++) {
        const stats = counts.get(i) || { total: 0, filled: 0 };
        if (stats.total > 0 && stats.filled >= stats.total) {
            continue;
        }

        const swatch = document.createElement('div');
        swatch.className = `swatch ${i === activeColorId ? 'selected' : ''}`;
        swatch.style.backgroundColor = colorPalette[i];
        swatch.textContent = i;
        swatch.onclick = () => {
            activeColorId = i;
            document.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');
            draw();
        };
        bar.appendChild(swatch);
    }
}

function createLevelCard(levelIdx, coloredIndices = []) {
    const card = document.createElement('div');
    card.className = 'level-card';

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = GRID_SIZE;
    previewCanvas.height = GRID_SIZE;
    previewCanvas.className = 'card-preview';
    const pCtx = previewCanvas.getContext('2d');

    const totalPixels = GRID_SIZE * GRID_SIZE;
    const progressCount = coloredIndices.length;

    pCtx.fillStyle = '#cacaca';
    pCtx.fillRect(0, 0, GRID_SIZE, GRID_SIZE);

    if (progressCount > 0) {
        const coloredSet = new Set(coloredIndices);

        if (currentCategory === 'mandala') {
            let currentSeed = (levelIdx + 1) * 123456789;
            function nextRandom() {
                currentSeed = (currentSeed * 1664525 + 1013904223) % 4294967296;
                return currentSeed / 4294967296;
            }

            let tempPalette = ['#e0e0e0'];
            for (let i = 1; i <= TARGET_COLORS_COUNT; i++) {
                const r = Math.floor(nextRandom() * 190) + 40;
                const g = Math.floor(nextRandom() * 190) + 40;
                const b = Math.floor(nextRandom() * 190) + 40;
                tempPalette.push(`rgb(${r},${g},${b})`);
            }

            const centerX = GRID_SIZE / 2;
            const centerY = GRID_SIZE / 2;

            coloredSet.forEach(idx => {
                const x = idx % GRID_SIZE;
                const y = Math.floor(idx / GRID_SIZE);
                const dx = x - centerX;
                const dy = y - centerY;
                const r = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx);
                const val = (Math.sin(r * 0.8) + Math.cos(angle * 12) + 2) / 4;
                const colorIdx = Math.floor(val * (TARGET_COLORS_COUNT - 1)) + 1;

                pCtx.fillStyle = tempPalette[colorIdx] || '#ffffff';
                pCtx.fillRect(x, y, 1, 1);
            });
        } else {
            coloredSet.forEach(idx => {
                const x = idx % GRID_SIZE;
                const y = Math.floor(idx / GRID_SIZE);
                pCtx.fillStyle = '#00adb5';
                pCtx.fillRect(x, y, 1, 1);
            });
        }
    }

    card.innerHTML = `
        <div style="font-weight:bold; margin-top:6px;">${currentCategory.toUpperCase()} #${levelIdx + 1}</div>
        <div style="font-size:11px; color:#888;">${progressCount} / ${totalPixels} px</div>
    `;
    card.prepend(previewCanvas);

    card.onclick = async () => {
        document.getElementById('home-screen').classList.remove('active');
        document.getElementById('game-screen').classList.add('active');
        await initLevel(levelIdx);
    };
    return card;
}

async function renderPortfolioGallery() {
    const inProgress = document.getElementById('in-progress-gallery');
    const completed = document.getElementById('completed-gallery');
    inProgress.innerHTML = ''; 
    completed.innerHTML = '';

    const progressMap = new Map();
    const userId = currentUser ? currentUser.id : 'guest';
    const prefix = `grid_save_${userId}_${currentCategory}_`;

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(prefix) || key.startsWith(`grid_save_guest_${currentCategory}_`))) {
            const parts = key.split('_');
            if (parts.length >= 6) {
                const cat = parts[3];
                const levelIdx = parseInt(parts[4], 10);
                const keyGridSize = parseInt(parts[5], 10);

                if (cat === currentCategory && !isNaN(levelIdx) && keyGridSize === GRID_SIZE) {
                    try {
                        const saved = JSON.parse(localStorage.getItem(key) || '[]');
                        if (Array.isArray(saved) && saved.length > 0) {
                            progressMap.set(levelIdx, saved);
                        }
                    } catch(e){}
                }
            }
        }
    }

    if (currentUser && supabaseClient) {
        const { data, error } = await supabaseClient.from('user_progress')
            .select('level_index, colored_indices')
            .eq('user_id', currentUser.id)
            .eq('category', currentCategory);

        if (!error && data) {
            for (const row of data) {
                const indices = row.colored_indices || [];
                if (indices.length > 0) {
                    progressMap.set(row.level_index, indices);
                    localStorage.setItem(`${prefix}${row.level_index}_${GRID_SIZE}`, JSON.stringify(indices));
                }
            }
        }
    }

    const totalPixels = GRID_SIZE * GRID_SIZE;

    progressMap.forEach((indices, levelIdx) => {
        if (activeTheme !== 'all' && getLevelTheme(levelIdx) !== activeTheme) return;

        const card = createLevelCard(levelIdx, indices);
        if (indices.length >= totalPixels) completed.appendChild(card);
        else inProgress.appendChild(card);
    });

    for (let i = 0; i < 24; i++) {
        if (!progressMap.has(i)) {
            if (activeTheme === 'all' || getLevelTheme(i) === activeTheme) {
                inProgress.appendChild(createLevelCard(i, []));
            }
        }
    }
}

async function returnToGallery() {
    clearInterval(timerInterval);
    await saveState(true);
    isLevelLoaded = false;
    hintMarker = null;
    customImageUrl = "";
    document.getElementById('game-screen').classList.remove('active');
    document.getElementById('home-screen').classList.add('active');
    await renderPortfolioGallery();
}

async function moveLevel(dir) {
    clearInterval(timerInterval);
    await saveState(true);
    isLevelLoaded = false;
    hintMarker = null;
    customImageUrl = "";
    const next = currentLevel + dir;
    if (next >= 0 && next < TOTAL_LEVELS) await initLevel(next);
}

async function logout() {
    if (isLevelLoaded) {
        await saveState(true);
    }
    if (realtimeChannel && supabaseClient) {
        supabaseClient.removeChannel(realtimeChannel);
    }
    if (supabaseClient) {
        await supabaseClient.auth.signOut();
    }
    currentUser = null;
    location.reload();
}

window.addEventListener('resize', () => { resizeCanvas(); draw(); });
window.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') await saveState(true);
});
window.addEventListener('pagehide', async () => await saveState(true));
window.addEventListener('beforeunload', async () => await saveState(true));

window.addEventListener('load', async () => {
    loadSettings();
    renderCategoryTabs();
    if (supabaseClient) {
        await initAuthSession();
    } else {
        bypassAuth();
    }
});