/**
 * Product Information Search Application - Core Logic
 */

// Global state
const APP_STATE = {
  products: [],
  history: [],
  config: {
    sheetUrl: '',
    lastSync: '',
    masterSyncs: {} // key: masterType, value: { rowCount: X, timestamp: Y }
  },
  currentView: 'home', // 'home' or 'details'
  currentProductId: null,
  html5Qrcode: null
};

// LocalStorage Keys
const STORAGE_KEYS = {
  PRODUCTS: 'prod_search_data',
  HISTORY: 'prod_search_history',
  CONFIG: 'prod_search_config'
};

// ==========================================================================
// INDEXEDDB HELPER FOR PDF MANUALS
// ==========================================================================
class IndexedDBHelper {
  constructor() {
    this.dbName = 'ProductSearchDB';
    this.dbVersion = 1;
    this.db = null;
  }

  init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onerror = (e) => reject(e);
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('pdfs')) {
          db.createObjectStore('pdfs', { keyPath: 'sku' });
        }
      };
    });
  }

  savePdf(sku, blob, fileName) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject("Database not initialized");
      const transaction = this.db.transaction(['pdfs'], 'readwrite');
      const store = transaction.objectStore('pdfs');
      const request = store.put({ sku: sku, blob: blob, fileName: fileName });
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e);
    });
  }

  getPdf(sku) {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve(null);
      const transaction = this.db.transaction(['pdfs'], 'readonly');
      const store = transaction.objectStore('pdfs');
      const request = store.get(sku);
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e);
    });
  }

  getAllPdfKeys() {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve([]);
      const transaction = this.db.transaction(['pdfs'], 'readonly');
      const store = transaction.objectStore('pdfs');
      const request = store.getAllKeys();
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e);
    });
  }

  clearAllPdfs() {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject("Database not initialized");
      const transaction = this.db.transaction(['pdfs'], 'readwrite');
      const store = transaction.objectStore('pdfs');
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e);
    });
  }
}

const pdfStore = new IndexedDBHelper();

// ==========================================================================
// SEARCH ENGINE CLASS (Modular & Future-Proofed)
// ==========================================================================
class ProductSearchEngine {
  constructor(productsList) {
    this.products = productsList || [];
  }

  updateData(newProducts) {
    this.products = newProducts;
  }

  /**
   * Performs partial-match search on Product Number, JAN code, or Name
   * Can be easily extended to integrate AI/Vector search in the future.
   */
  search(query) {
    if (!query) return [];
    
    const cleanQuery = query.trim().toLowerCase();
    
    // 1. Filter products that match the query in any field
    const matches = this.products.filter(product => {
      const sku = (product['商品番号'] || '').toLowerCase();
      const jan = (product['JANコード'] || '').toLowerCase();
      const name = (product['商品名'] || '').toLowerCase();
      const desc = (product['商品説明'] || '').toLowerCase();
      const features = (product['特徴'] || '').toLowerCase();
      
      return sku.includes(cleanQuery) || 
             jan.includes(cleanQuery) || 
             name.includes(cleanQuery) ||
             desc.includes(cleanQuery) ||
             features.includes(cleanQuery);
    });
    
    // 2. Sort matches by relevance score (lower score = higher relevance)
    return matches.sort((a, b) => {
      const aSku = (a['商品番号'] || '').toLowerCase();
      const bSku = (b['商品番号'] || '').toLowerCase();
      const aJan = (a['JANコード'] || '').toLowerCase();
      const bJan = (b['JANコード'] || '').toLowerCase();
      const aName = (a['商品名'] || '').toLowerCase();
      const bName = (b['商品名'] || '').toLowerCase();
      
      const getScore = (sku, jan, name) => {
        // A. Exact SKU match: 0
        if (sku === cleanQuery) return 0;
        
        // B. Exact JAN match: 1
        if (jan === cleanQuery) return 1;
        
        // C. SKU prefix match: 2
        if (sku.startsWith(cleanQuery)) return 2;
        
        // D. Name exact match: 3
        if (name === cleanQuery) return 3;
        
        // E. Name prefix match: 4
        if (name.startsWith(cleanQuery)) return 4;
        
        // F. SKU contains query: 5
        if (sku.includes(cleanQuery)) return 5;
        
        // G. Name contains query: 6
        if (name.includes(cleanQuery)) return 6;
        
        // H. Description / Features matches: 7
        return 7;
      };
      
      const scoreA = getScore(aSku, aJan, aName);
      const scoreB = getScore(bSku, bJan, bName);
      
      if (scoreA !== scoreB) {
        return scoreA - scoreB;
      }
      
      // Secondary sort: shorter SKU first (e.g. TM066 before TM066MB)
      return aSku.length - bSku.length;
    });
  }

  findById(productId) {
    return this.products.find(p => p['商品番号'] === productId);
  }

  findByJan(janCode) {
    return this.products.find(p => p['JANコード'] === janCode);
  }
}

let SearchEngine = new ProductSearchEngine([]);

// ==========================================================================
// SECURITY AUTHENTICATION GATEWAY
// ==========================================================================
// Hash function helper using Web Cryptography API
async function calculateSHA256(text) {
  const msgBuffer = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkSecurityAuthentication() {
  const loginGate = document.getElementById('loginGate');
  if (!loginGate) return;

  // If already authenticated during this session, bypass login gate
  if (sessionStorage.getItem('authenticated') === 'true') {
    loginGate.style.display = 'none';
    return;
  }

  // Show login gate
  loginGate.style.display = 'flex';

  const passwordInput = document.getElementById('loginPasswordInput');
  const submitBtn = document.getElementById('loginSubmitBtn');
  const errorMsg = document.getElementById('loginErrorMsg');

  const attemptLogin = async () => {
    const inputPass = passwordInput.value;
    if (!inputPass) return;

    errorMsg.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.innerText = '認証中...';

    try {
      const inputHash = await calculateSHA256(inputPass);
      // Default fallback password hash for "bodymaker"
      let targetHash = '438790e1dab101ed5cfb470c4e20c2d6ed052787c3507890786b640adcaffa37';

      // Fetch dynamic security.json config from server
      try {
        const res = await fetch('security.json');
        if (res.ok) {
          const config = await res.json();
          if (config && config.passwordHash) {
            targetHash = config.passwordHash;
          }
        }
      } catch (err) {
        console.warn("Could not load security.json from server, using default fallback password.", err);
      }

      if (inputHash === targetHash) {
        sessionStorage.setItem('authenticated', 'true');
        loginGate.style.transition = 'opacity 0.4s ease';
        loginGate.style.opacity = '0';
        setTimeout(() => {
          loginGate.style.display = 'none';
        }, 400);
      } else {
        errorMsg.style.display = 'block';
        passwordInput.value = '';
        passwordInput.focus();
      }
    } catch (e) {
      console.error(e);
      errorMsg.innerText = 'エラーが発生しました。';
      errorMsg.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = 'ログイン';
    }
  };

  submitBtn.addEventListener('click', attemptLogin);
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      attemptLogin();
    }
  });
}

// ==========================================================================
// APPLICATION INITIALIZATION
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  checkSecurityAuthentication();
  loadStoredConfig();
  loadStoredHistory();
  initializeUI();
  
  // Initialize IndexedDB pdf store
  pdfStore.init().then(() => {
    updateVideoUrlBadge();
  }).catch(err => {
    console.error("IndexedDB initialization failed:", err);
  });
  
  // Try loading cached product database. If empty, load default CSV.
  loadCachedProductsOrFetchDefault();
  
  // Update master sync display badges
  updateMasterSyncBadges();

  // Initialize Multi-Master Import UI bindings
  initializeMasterImportUI();
});

// ==========================================================================
// DATA FETCHING & SYNCING (Google Sheets & Local CSV)
// ==========================================================================

// Load configurations from localStorage
function loadStoredConfig() {
  const stored = localStorage.getItem(STORAGE_KEYS.CONFIG);
  if (stored) {
    try {
      APP_STATE.config = JSON.parse(stored);
    } catch (e) {
      console.error("Failed to parse config", e);
    }
  }
}

// Load recently searched history
function loadStoredHistory() {
  const stored = localStorage.getItem(STORAGE_KEYS.HISTORY);
  if (stored) {
    try {
      APP_STATE.history = JSON.parse(stored);
    } catch (e) {
      console.error("Failed to parse history", e);
    }
  }
}

// Save config helper
function saveConfig() {
  localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(APP_STATE.config));
}

// Save history helper
function saveHistory() {
  localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(APP_STATE.history));
}

// Fetch products from cache or fall back to bundled CSV
function loadCachedProductsOrFetchDefault() {
  const cachedData = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
  if (cachedData) {
    try {
      APP_STATE.products = JSON.parse(cachedData);
      SearchEngine.updateData(APP_STATE.products);
      updateDashboardStats();
      console.log(`Loaded ${APP_STATE.products.length} products from localStorage cache.`);
      return;
    } catch (e) {
      console.warn("Failed to load cached products. Fetching default CSV...", e);
    }
  }
  
  // Cache is empty or corrupt. Fetch default bundled data.csv.
  fetchBundledCsv();
}

// Default fallback database (used when local data.csv fetch is blocked by browser CORS security)
const DEFAULT_CSV_DATA = `商品番号,JANコード,商品名,価格,在庫数,カラー,サイズ,重量,送料区分,梱包サイズ,商品説明,特徴,素材,耐荷重,付属品,注意事項,保証期間,組立時間,組立人数,関連商品,取扱説明書PDF,組立動画URL,使用動画URL,商品画像
MTR-100,4901234567890,スチール製 頑丈ラック 5段,12800,45,マットブラック,W900×D450×H1800mm,18.5kg,中型便,W950×D500×H150mm,倉庫や店舗の整理に最適な高耐荷重スチールラック。棚板の位置は調整可能。,・ボルトレスで簡単組立\\n・1段あたり耐荷重150kgの頑丈設計\\n・サビに強い粉体塗装仕上げ,スチール（紛体塗装）・MDF棚板,棚板1枚あたり：150kg（全体：750kg）,支柱×4棚板×5補強バー×10ゴム脚×4ゴムハンマー×1,・平らな場所に設置してください。\\n・必ず耐荷重の範囲内でご使用ください。\\n・組立時は軍手を着用してください。,1年間,20分,1人,"CHR-305,BOX-501",https://example.com/manuals/mtr-100.pdf,https://www.youtube.com/embed/dQw4w9WgXcQ,https://www.youtube.com/embed/dQw4w9WgXcQ,images/mtr100.png
DSK-202,4901234567891,エルゴノミクス 電動昇降デスク,49800,12,オーク＆ホワイト,W1200×D600×H700-1150mm,28kg,大型便,W1250×D650×H220mm,体型や姿勢に合わせて高さを自在に調整できる電動昇降デスク。静音モーター搭載。,・メモリー機能付きコントローラー\\n・衝突検知センサーによる自動停止機能\\n・頑丈なスチール製フレーム,天板：メラミン化粧板・フレーム：スチール,60kg,昇降デスク本体×1電源ケーブル×1組立用ネジ一式六角レンチ×1,・昇降動作中は周囲に障害物がないか確認してください。\\n・過荷重状態で昇降させないでください。,2年間,40分,2人,"MTR-100,CHR-305",https://example.com/manuals/dsk-202.pdf,https://www.youtube.com/embed/dQw4w9WgXcQ,https://www.youtube.com/embed/dQw4w9WgXcQ,images/dsk202.png
CHR-305,4901234567892,高通気性 メッシュオフィスチェア,18800,28,グレー＆ホワイト,W650×D650×H1150-1250mm,14kg,中型便,W700×D680×H380mm,長時間のデスクワークでも蒸れにくい高弾性メッシュ素材を採用したオフィスチェア。,・可動式ヘッドレスト＆アームレスト\\n・シンクロロッキング機能搭載\\n・ランバーサポート（腰当て）位置調整可能,ポリエステルメッシュ・ナイロン樹脂ベース・ウレタンキャスター,120kg,チェア本体パーツ一式ガスシリンダー×1キャスター×5組立工具×1,・フローリングで使用する際は椅子の下にカーペット等を敷くことをお勧めします。,1年間,25分,1人,"DSK-202,LMP-408",https://example.com/manuals/chr-305.pdf,https://www.youtube.com/embed/dQw4w9WgXcQ,https://www.youtube.com/embed/dQw4w9WgXcQ,images/chr305.png
LMP-408,4901234567893,高演色 LED クランプライト,6980,15,ホワイト,W350×D200×H450mm,1.2kg,小物便,W400×D250×H100mm,自然光に近い演色性（Ra95）を実現し、デスク作業や読書に最適なクランプ式アームライト。,・5段階調光＆3色調色機能付き\\n・アーム角度を自在に調節可能\\n・机を広く使えるクランプ固定式,アルミ・ABS樹脂,-,LEDライト本体×1ACアダプター×1クランプ金具×1取扱説明書,-,1年間,5分,1人,"DSK-202,CHR-305",https://example.com/manuals/lmp-408.pdf,,https://www.youtube.com/embed/dQw4w9WgXcQ,images/lmp408.png
BOX-501,4901234567894,キャスター付き 大容量収納ボックス,3980,85,クリアブラック,W400×D700×H350mm,2.8kg,中型便,W410×D710×H360mm,衣類や備品の整理に便利な大容量スタッキングボックス。キャスター付きで移動もラクラク。,・半透明で中身が見えやすい\\n・スタッキング（積み重ね）対応\\n・移動に便利なキャスター付き,ポリプロピレン,天板荷重：10kg（積み重ね最大3段まで）,収納ボックス本体×1フタ×1キャスター×4,・耐荷重を超える荷重をかけないでください。\\n・積み重ねの際はバランスに注意してください。,初期不良のみ,なし,1人,"MTR-100",https://example.com/manuals/box-501.pdf,,https://www.youtube.com/embed/dQw4w9WgXcQ,images/box501.png`;

// Fetch bundled CSV
function fetchBundledCsv() {
  fetch('data.csv')
    .then(response => {
      if (!response.ok) {
        throw new Error('data.csv not found');
      }
      return response.text();
    })
    .then(csvText => {
      parseAndSaveCsv(csvText, 'Bundled data.csv');
    })
    .catch(error => {
      console.warn('CORS or file access restriction blocked data.csv fetch. Falling back to embedded dataset:', error);
      // Bypasses file:// CORS restriction
      parseAndSaveCsv(DEFAULT_CSV_DATA, 'Default Fallback Data');
    });
}

// Parse CSV text and save to memory and cache
function parseAndSaveCsv(csvText, sourceName) {
  // Remove BOM if present (e.g. from Excel exports)
  if (csvText && csvText.startsWith('\ufeff')) {
    csvText = csvText.slice(1);
  }

  Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    complete: function(results) {
      if (results.data && results.data.length > 0) {
        // Parse JSON strings back to objects
        results.data.forEach(p => {
          if (p['店在庫'] && typeof p['店在庫'] === 'string' && p['店在庫'].trim().startsWith('{')) {
            try {
              p['店在庫'] = JSON.parse(p['店在庫']);
            } catch (e) {
              console.warn("Failed to parse store stock JSON:", e);
            }
          }
          if (p['components'] && typeof p['components'] === 'string' && p['components'].trim().startsWith('[')) {
            try {
              p['components'] = JSON.parse(p['components']);
            } catch (e) {
              console.warn("Failed to parse components JSON:", e);
            }
          }
          if (p['isSetProduct'] === 'true') p.isSetProduct = true;
          if (p['isSetProduct'] === 'false') p.isSetProduct = false;
        });

        APP_STATE.products = results.data;
        SearchEngine.updateData(APP_STATE.products);
        
        // Cache to localStorage
        localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(APP_STATE.products));
        
        // Update sync timestamp
        const now = new Date();
        const dateString = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        APP_STATE.config.lastSync = dateString;
        saveConfig();
        
        updateDashboardStats();
        showNotification(`${results.data.length}件のデータをロードしました (${sourceName})`);
        
        // Refresh suggestions/UI if we are looking up
        triggerInputSearch();
      } else {
        showNotification('CSVの解析結果が空です。形式を確認してください。', 'error');
      }
    },
    error: function(err) {
      console.error('PapaParse error:', err);
      showNotification('CSVの解析に失敗しました。', 'error');
    }
  });
}

// Fetch from Google Sheet CSV Export
function syncWithGoogleSheet() {
  const urlInput = APP_STATE.config.sheetUrl;
  if (!urlInput) {
    showNotification('スプレッドシートのURLが登録されていません。', 'error');
    return;
  }

  let csvExportUrl = urlInput.trim();
  
  // If it's a standard edit/share URL, convert it to direct CSV export format
  if (csvExportUrl.includes('/edit')) {
    const match = csvExportUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      const sheetId = match[1];
      csvExportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    } else {
      showNotification('無効なGoogleスプレッドシートURLです。', 'error');
      return;
    }
  }
  // If it's a "Publish to Web" URL but doesn't output CSV, convert it!
  else if (csvExportUrl.includes('/d/e/2PACX-') && !csvExportUrl.includes('output=csv')) {
    csvExportUrl = csvExportUrl.replace(/\/pubhtml$/, '/pub?output=csv')
                               .replace(/\/pub$/, '/pub?output=csv');
    // If it still doesn't have output=csv, append it
    if (!csvExportUrl.includes('output=csv')) {
      if (csvExportUrl.endsWith('/')) {
        csvExportUrl += 'pub?output=csv';
      } else if (!csvExportUrl.includes('/pub')) {
        csvExportUrl += '/pub?output=csv';
      }
    }
  }

  showNotification('Googleスプレッドシートからデータを同期中...', 'info');

  fetch(csvExportUrl)
    .then(res => {
      if (!res.ok) throw new Error('スプレッドシートのダウンロードに失敗しました。');
      return res.text();
    })
    .then(csvText => {
      parseAndSaveCsv(csvText, 'Googleスプレッドシート');
      closeModal('settingsModal');
    })
    .catch(err => {
      console.error(err);
      showNotification('Googleスプレッドシート同期エラー。公開設定を確認してください。', 'error');
    });
}

// ==========================================================================
// UI & EVENT BINDINGS
// ==========================================================================
function initializeUI() {
  // Elements
  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');
  const scanBtn = document.getElementById('scanBtn');
  const suggestions = document.getElementById('suggestions');
  const settingsBtn = document.getElementById('settingsBtn');
  
  // Tab Anchors click
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const sectionId = btn.getAttribute('data-target');
      const targetElement = document.getElementById(sectionId);
      
      if (targetElement) {
        // Remove active class from all tabs
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Smooth scroll to element
        targetElement.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // Search input events
  searchInput.addEventListener('input', () => {
    const query = searchInput.value;
    if (query.trim().length > 0) {
      searchClear.style.display = 'block';
      showSuggestions(query);
    } else {
      searchClear.style.display = 'none';
      suggestions.style.display = 'none';
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const results = SearchEngine.search(searchInput.value);
      if (results.length > 0) {
        // Go straight to the first result
        showProductDetails(results[0]['商品番号']);
        searchInput.blur();
        suggestions.style.display = 'none';
      } else {
        showNotification('一致する商品が見つかりませんでした。', 'warning');
      }
    }
  });

  // Focus out hides suggestions (with delay so clicks register)
  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      suggestions.style.display = 'none';
    }, 200);
  });

  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim().length > 0) {
      showSuggestions(searchInput.value);
    }
  });

  // Clear search bar
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    suggestions.style.display = 'none';
    searchInput.focus();
  });

  // Camera scan trigger
  scanBtn.addEventListener('click', () => {
    openModal('scannerModal');
    startCameraScanner();
  });

  // Settings trigger
  settingsBtn.addEventListener('click', () => {
    // Populate spreadsheet URL in modal
    document.getElementById('sheetUrlInput').value = APP_STATE.config.sheetUrl || '';
    openModal('settingsModal');
  });

  // Settings Save
  document.getElementById('saveSettingsBtn').addEventListener('click', () => {
    const url = document.getElementById('sheetUrlInput').value.trim();
    APP_STATE.config.sheetUrl = url;
    saveConfig();
    
    if (url) {
      syncWithGoogleSheet();
    } else {
      showNotification('設定を保存しました。');
      closeModal('settingsModal');
    }
  });

  // Reset database btn
  document.getElementById('resetDbBtn').addEventListener('click', () => {
    if (confirm('ローカルキャッシュをクリアし、初期データベース(data.csv)に戻しますか？')) {
      localStorage.removeItem(STORAGE_KEYS.PRODUCTS);
      fetchBundledCsv();
      closeModal('settingsModal');
    }
  });

  // Local file upload handling
  document.getElementById('csvFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
      const text = evt.target.result;
      
      // Auto-detect Shift_JIS encoding (if it contains replacement characters)
      if (text.includes('\uFFFD')) {
        console.log("Detected mojibake with UTF-8. Re-reading file as Shift_JIS...");
        const sjisReader = new FileReader();
        sjisReader.onload = function(sjisEvt) {
          parseAndSaveCsv(sjisEvt.target.result, file.name);
          closeModal('settingsModal');
        };
        sjisReader.readAsText(file, 'Shift_JIS');
      } else {
        parseAndSaveCsv(text, file.name);
        closeModal('settingsModal');
      }
    };
    reader.readAsText(file, 'UTF-8');
  });

  // Back to Top / Home button scroll observer
  const backToTopBtn = document.getElementById('backToTopBtn');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 200 && APP_STATE.currentView === 'details') {
      backToTopBtn.classList.add('visible');
    } else {
      backToTopBtn.classList.remove('visible');
    }
    
    // Active Tab Highlight on Scroll
    if (APP_STATE.currentView === 'details') {
      const sections = ['info', 'stock', 'assembly', 'manual', 'video', 'related'];
      let activeSectionId = '';
      
      for (const id of sections) {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          // If the top of the element is near the top of the screen (considering sticky header offset)
          if (rect.top <= 230) {
            activeSectionId = id;
          }
        }
      }
      
      if (activeSectionId) {
        tabBtns.forEach(btn => {
          if (btn.getAttribute('data-target') === activeSectionId) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });
      }
    }
  });

  backToTopBtn.addEventListener('click', () => {
    // Jump scroll to top of page and reset to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Close modals clicking overlay
  const modals = document.querySelectorAll('.modal-overlay');
  modals.forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        const modalId = modal.getAttribute('id');
        closeModal(modalId);
        if (modalId === 'scannerModal') {
          stopCameraScanner();
        }
      }
    });
  });
}

// Trigger input search manual callback
function triggerInputSearch() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput.value.trim().length > 0) {
    showSuggestions(searchInput.value);
  }
}

// Show notification banner
function showNotification(message, type = 'info') {
  let toast = document.getElementById('toastNotification');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toastNotification';
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.backgroundColor = 'rgba(18, 18, 18, 0.95)';
    toast.style.border = '1px solid var(--color-yellow-primary)';
    toast.style.borderRadius = '30px';
    toast.style.padding = '12px 24px';
    toast.style.fontSize = '14px';
    toast.style.fontWeight = '700';
    toast.style.color = '#FFFFFF';
    toast.style.zIndex = '9999';
    toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.textAlign = 'center';
    toast.style.width = '90%';
    toast.style.maxWidth = '400px';
    document.body.appendChild(toast);
  }

  // Set colors based on type
  if (type === 'error') {
    toast.style.borderColor = 'var(--color-status-danger)';
    toast.style.color = 'var(--color-status-danger)';
  } else if (type === 'warning') {
    toast.style.borderColor = 'var(--color-status-warning)';
    toast.style.color = 'var(--color-status-warning)';
  } else {
    toast.style.borderColor = 'var(--color-yellow-primary)';
    toast.style.color = '#FFFFFF';
  }

  toast.innerHTML = message;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';

  // Hide after 3 seconds
  clearTimeout(toast.timeoutId);
  toast.timeoutId = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
  }, 3500);
}

// Modal actions
function openModal(id) {
  const modal = document.getElementById(id);
  modal.classList.add('open');
}
window.openModal = openModal;

function closeModal(id) {
  const modal = document.getElementById(id);
  modal.classList.remove('open');
  if (id === 'scannerModal') {
    stopCameraScanner();
  }
}
window.closeModal = closeModal;

// ==========================================================================
// SUGGESTIONS LOGIC
// ==========================================================================
function showSuggestions(query) {
  const suggestions = document.getElementById('suggestions');
  const results = SearchEngine.search(query);
  
  if (results.length === 0) {
    suggestions.innerHTML = '<div class="empty-state">一致する商品がありません</div>';
    suggestions.style.display = 'block';
    return;
  }

  // Limit suggestions list to 5 items
  const showList = results.slice(0, 5);
  let html = '';
  
  showList.forEach(item => {
    const sku = item['商品番号'] || 'N/A';
    const name = item['商品名'] || '無題の商品';
    const price = formatPrice(item['価格']);
    const stock = item['在庫数'] || '0';
    
    html += `
      <div class="suggestion-item" onclick="selectSuggestion('${sku}')">
        <div class="suggest-header">
          <span class="suggest-name">${name}</span>
          <span class="suggest-code">${sku}</span>
        </div>
        <div class="suggest-meta">
          <span>価格: ${price}</span>
          <span>在庫: ${stock}点</span>
        </div>
      </div>
    `;
  });
  
  suggestions.innerHTML = html;
  suggestions.style.display = 'block';
}

// Callback when user taps suggestion
window.selectSuggestion = function(sku) {
  document.getElementById('searchInput').value = sku;
  document.getElementById('searchClear').style.display = 'block';
  document.getElementById('suggestions').style.display = 'none';
  showProductDetails(sku);
};

// Helper to format price with yen symbol
function formatPrice(val) {
  if (!val) return '未定';
  const num = parseInt(val, 10);
  if (isNaN(num)) return val;
  return `¥${num.toLocaleString()}`;
}

// ==========================================================================
// VIEW SWITCHER & PRODUCT DETAILS POPULATION
// ==========================================================================
function updateDashboardStats() {
  document.getElementById('totalCountVal').innerText = APP_STATE.products.length;
  document.getElementById('syncTimeVal').innerText = APP_STATE.config.lastSync || '未同期';
  
  // Render search history
  renderSearchHistory();
}

function renderSearchHistory() {
  const historyList = document.getElementById('historyList');
  if (APP_STATE.history.length === 0) {
    historyList.innerHTML = '<div class="empty-state">最近の検索履歴はありません</div>';
    return;
  }

  let html = '';
  APP_STATE.history.forEach((product, idx) => {
    const sku = product['商品番号'];
    const name = product['商品名'];
    
    html += `
      <div class="history-item" onclick="showProductDetails('${sku}')">
        <div class="history-item-left">
          <span class="history-item-icon">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </span>
          <div class="history-item-info">
            <span class="history-item-name">${name}</span>
            <span class="history-item-code">${sku}</span>
          </div>
        </div>
        <button class="history-delete-btn" onclick="deleteHistoryItem(event, ${idx})">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
    `;
  });
  
  historyList.innerHTML = html;
}

window.deleteHistoryItem = function(event, index) {
  event.stopPropagation(); // Avoid triggering card click
  APP_STATE.history.splice(index, 1);
  saveHistory();
  renderSearchHistory();
};

// Add product to history
function addToHistory(product) {
  // Remove if duplicate exists
  APP_STATE.history = APP_STATE.history.filter(p => p['商品番号'] !== product['商品番号']);
  
  // Add to front
  APP_STATE.history.unshift(product);
  
  // Keep only 5 items
  if (APP_STATE.history.length > 5) {
    APP_STATE.history.pop();
  }
  
  saveHistory();
  renderSearchHistory();
}

// Dynamic EAN/JAN Barcode SVG generator
function drawEANBarcode(code) {
  code = code.replace(/\D/g, '');
  if (code.length !== 13 && code.length !== 8) {
    return null;
  }
  
  const A = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const B = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
  const C = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
  
  let bin = "";
  
  if (code.length === 13) {
    const first = parseInt(code[0], 10);
    const parity = [
      [0,0,0,0,0,0], // 0
      [0,0,1,0,1,1], // 1
      [0,0,1,1,0,1], // 2
      [0,0,1,1,1,0], // 3
      [0,1,0,0,1,1], // 4
      [0,1,1,0,0,1], // 5
      [0,1,1,1,0,0], // 6
      [0,1,0,1,0,1], // 7
      [0,1,0,1,1,0], // 8
      [0,1,1,0,1,0]  // 9
    ][first];
    
    bin += "101"; // Start
    for (let i = 1; i <= 6; i++) {
      const digit = parseInt(code[i], 10);
      const isB = parity[i - 1];
      bin += isB ? B[digit] : A[digit];
    }
    bin += "01010"; // Center
    for (let i = 7; i <= 12; i++) {
      const digit = parseInt(code[i], 10);
      bin += C[digit];
    }
    bin += "101"; // End
  } else {
    bin += "101"; // Start
    for (let i = 0; i < 4; i++) {
      const digit = parseInt(code[i], 10);
      bin += A[digit];
    }
    bin += "01010"; // Center
    for (let i = 4; i < 8; i++) {
      const digit = parseInt(code[i], 10);
      bin += C[digit];
    }
    bin += "101"; // End
  }
  
  const moduleWidth = 1.6;
  const height = 32;
  const textHeight = 12;
  const totalWidth = bin.length * moduleWidth;
  
  let svg = `<svg width="${totalWidth + 12}" height="${height + textHeight + 4}" viewBox="0 0 ${totalWidth + 12} ${height + textHeight + 4}" xmlns="http://www.w3.org/2000/svg" style="background:#ffffff; padding: 4px; border-radius: 4px; display: block;">`;
  
  let x = 6;
  for (let i = 0; i < bin.length; i++) {
    if (bin[i] === '1') {
      const isGuard = (i < 3) || (i >= bin.length - 3) || (code.length === 13 ? (i >= 45 && i < 50) : (i >= 31 && i < 36));
      const barHeight = isGuard ? height + 4 : height;
      svg += `<rect x="${x}" y="2" width="${moduleWidth}" height="${barHeight}" fill="#000000" />`;
    }
    x += moduleWidth;
  }
  
  svg += `<text x="${(totalWidth + 12) / 2}" y="${height + textHeight + 2}" font-family="'Outfit', monospace" font-size="9" fill="#000000" text-anchor="middle" letter-spacing="0.5" font-weight="600">${code}</text>`;
  svg += `</svg>`;
  
  return svg;
}

// Show Product details screen
window.showProductDetails = function(sku) {
  const product = SearchEngine.findById(sku);
  if (!product) {
    showNotification('該当する商品データがありません。', 'error');
    return;
  }

  // Helper to fallback to base SKU (first 5 chars) if variant spec is empty
  const getProductSpec = (p, specKey) => {
    if (p[specKey]) return p[specKey];
    const itemSku = p['商品番号'] || '';
    if (itemSku.length > 5) {
      const basePrefix = itemSku.substring(0, 5).toLowerCase();
      const baseProduct = APP_STATE.products.find(x => 
        (x['商品番号'] || '').toLowerCase() === basePrefix
      );
      if (baseProduct && baseProduct[specKey]) {
        return baseProduct[specKey];
      }
    }
    return '';
  };

  APP_STATE.currentProductId = sku;
  APP_STATE.currentView = 'details';
  addToHistory(product);

  // Switch screens
  document.getElementById('dashboardView').style.display = 'none';
  const detailsView = document.getElementById('detailsView');
  detailsView.style.display = 'block';

  // Fill in data
  
  // Image
  const imgBox = document.getElementById('detailImgBox');
  let imgSrc = getProductSpec(product, '商品画像');
  if (!imgSrc && !!product.isSetProduct && product.components && product.components.length > 0) {
    const firstComp = SearchEngine.findById(product.components[0].sku);
    if (firstComp && firstComp['商品画像']) {
      imgSrc = firstComp['商品画像'];
    }
  }

  if (imgSrc) {
    imgBox.innerHTML = `<img src="${imgSrc}" class="detail-img" alt="${product['商品名']}" onerror="imgLoadError(this)">`;
  } else {
    imgBox.innerHTML = `
      <div class="detail-img-fallback">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/></svg>
        <span>画像がありません</span>
      </div>`;
  }

  // SKU & JAN
  document.getElementById('detailSku').innerText = product['商品番号'];
  
  // Stock count & badge coloring
  const isSet = !!product.isSetProduct;
  let stockCount = 0;
  let calculatedSetStoreStock = {};
  
  if (isSet) {
    const comps = product.components || [];
    let minSetsTotal = Infinity;
    const storeSets = {};
    let compsHtml = '';
    
    comps.forEach(c => {
      const compProduct = SearchEngine.findById(c.sku) || {
        '商品名': c.name || '不明な商品',
        '商品番号': c.sku,
        '価格': '0',
        '在庫数': '0',
        '店在庫': {}
      };
      
      const cStock = parseInt(compProduct['在庫数'] || '0', 10);
      const cQty = parseInt(c.quantity || '1', 10);
      const possibleSets = Math.floor(cStock / cQty);
      if (possibleSets < minSetsTotal) {
        minSetsTotal = possibleSets;
      }
      
      // Store stocks
      const cStoreStock = compProduct['店在庫'] || {};
      Object.entries(cStoreStock).forEach(([store, val]) => {
        const num = parseInt(val, 10) || 0;
        const possibleStoreSets = Math.floor(num / cQty);
        if (!storeSets[store]) storeSets[store] = [];
        storeSets[store].push(possibleStoreSets);
      });
      
      let storePreview = '';
      if (Object.keys(cStoreStock).length > 0) {
        storePreview = Object.entries(cStoreStock)
          .map(([store, val]) => `${store}: ${val}点`)
          .join(', ');
      } else {
        storePreview = '店舗在庫なし';
      }

      const formattedPrice = formatPrice(compProduct['価格']);
      
      compsHtml += `
        <div class="set-component-card">
          <div class="set-component-header">
            <span class="set-component-name">${compProduct['商品名'] || c.name}</span>
            <span class="set-component-qty">構成比: ${cQty}</span>
          </div>
          <div class="set-component-meta">
            <span>品番: <strong>${compProduct['商品番号'] || c.sku}</strong></span>
            <span>単価: ${formattedPrice}</span>
          </div>
          <div class="set-component-meta" style="margin-top: 4px; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 4px;">
            <span>単品在庫数: <strong style="color:var(--color-yellow-primary);">${cStock} 点</strong> (セット可能数: ${possibleSets}件)</span>
          </div>
          <div style="font-size: 11px; color: var(--color-text-gray); line-height: 1.3; margin-top: 4px;">
            店在庫内訳: ${storePreview}
          </div>
          <button class="set-component-link-btn" onclick="showProductDetails('${compProduct['商品番号'] || c.sku}')">単品詳細を見る</button>
        </div>
      `;
    });
    
    if (minSetsTotal === Infinity) minSetsTotal = 0;
    stockCount = minSetsTotal;
    
    document.getElementById('detailSetCompositionContainer').innerHTML = compsHtml || '<div class="empty-state">構成商品情報がありません</div>';
    document.getElementById('detailSetCompositionSection').style.display = 'block';
    
    // Calculate store sets possible
    Object.entries(storeSets).forEach(([store, possibleSetsArray]) => {
      if (possibleSetsArray.length < comps.length) {
        calculatedSetStoreStock[store] = 0;
      } else {
        calculatedSetStoreStock[store] = Math.min(...possibleSetsArray);
      }
    });
    
    // Save to window for store stock rendering below
    window.tempCalculatedSetStoreStock = calculatedSetStoreStock;
  } else {
    stockCount = parseInt(product['在庫数'] || '0', 10);
    document.getElementById('detailSetCompositionSection').style.display = 'none';
    window.tempCalculatedSetStoreStock = null;
  }

  const stockBadge = document.getElementById('detailStockBadge');
  stockBadge.className = 'detail-stock-badge'; // reset
  if (isSet) {
    if (stockCount > 5) {
      stockBadge.className = 'detail-stock-badge ok';
      stockBadge.innerText = `セット可能数: ${stockCount} 点`;
    } else if (stockCount > 0) {
      stockBadge.className = 'detail-stock-badge warning';
      stockBadge.innerText = `残りわずか: セット可能 ${stockCount} 点`;
    } else {
      stockBadge.className = 'detail-stock-badge danger';
      stockBadge.innerText = `セット不可 (構成在庫不足)`;
    }
  } else {
    if (stockCount > 20) {
      stockBadge.className = 'detail-stock-badge ok';
      stockBadge.innerText = `在庫数: ${stockCount} 点`;
    } else if (stockCount > 0) {
      stockBadge.className = 'detail-stock-badge warning';
      stockBadge.innerText = `残りわずか: ${stockCount} 点`;
    } else {
      stockBadge.className = 'detail-stock-badge danger';
      stockBadge.innerText = `在庫なし`;
    }
  }

  // Basic Info
  document.getElementById('detailTitle').innerText = product['商品名'] || '未設定';
  
  if (isSet && !product['価格']) {
    const calculatedPrice = (product.components || []).reduce((sum, c) => {
      const compProduct = SearchEngine.findById(c.sku) || { '価格': '0' };
      return sum + (parseInt(compProduct['価格'] || '0', 10) * parseInt(c.quantity || '1', 10));
    }, 0);
    document.getElementById('detailPriceVal').innerText = calculatedPrice.toLocaleString();
  } else {
    document.getElementById('detailPriceVal').innerText = parseInt(product['価格'] || '0', 10).toLocaleString();
  }

  // Set JAN barcode at price row
  const janCode = (product['JANコード'] || '').trim().replace(/\D/g, '');
  const priceJanContainer = document.getElementById('detailPriceJan');
  if (janCode && (janCode.length === 13 || janCode.length === 8)) {
    const barcodeSvg = drawEANBarcode(janCode);
    if (barcodeSvg) {
      priceJanContainer.innerHTML = barcodeSvg;
      priceJanContainer.style.display = 'block';
    } else {
      priceJanContainer.style.display = 'none';
    }
  } else {
    priceJanContainer.style.display = 'none';
  }
  
  // Specs table
  document.getElementById('valSku').innerText = product['商品番号'] || '-';
  document.getElementById('valJan').innerText = product['JANコード'] || '-';
  document.getElementById('valColor').innerText = getProductSpec(product, 'カラー') || '-';
  document.getElementById('valSize').innerText = getProductSpec(product, 'サイズ') || '-';
  document.getElementById('valWeight').innerText = getProductSpec(product, '重量') || '-';
  document.getElementById('valShipping').innerText = getProductSpec(product, '送料区分') || '-';
  document.getElementById('valPackageSize').innerText = getProductSpec(product, '梱包サイズ') || '-';

  // Description
  document.getElementById('detailDesc').innerText = getProductSpec(product, '商品説明') || '商品説明はありません。';

  // Material & Capacity Spec
  document.getElementById('valMaterials').innerText = getProductSpec(product, '素材') || '-';
  document.getElementById('valCapacity').innerText = getProductSpec(product, '耐荷重') || '-';
  
  // Precautions bullet items
  const cautionList = document.getElementById('detailCaution');
  const cautionText = getProductSpec(product, '注意事項') || '';
  if (cautionText) {
    const listItems = cautionText.split('\\n').map(t => t.trim().replace(/^・/, '')).filter(Boolean);
    cautionList.innerHTML = listItems.map(item => `<li>${item}</li>`).join('');
  } else {
    cautionList.innerHTML = '<li>特になし</li>';
  }

  // Assembly Specifications
  document.getElementById('valWarranty').innerText = getProductSpec(product, '保証期間') || '-';
  document.getElementById('valAssemblyTime').innerText = getProductSpec(product, '組立時間') || 'なし';
  document.getElementById('valAssemblyCrew').innerText = getProductSpec(product, '組立人数') || 'なし';

  // Store inventory display (店在庫)
  const storeStockSection = document.getElementById('detailStoreStockSection');
  const storeStockContainer = document.getElementById('detailStoreStockContainer');
  
  if (isSet) {
    const calcStock = window.tempCalculatedSetStoreStock || {};
    if (Object.keys(calcStock).length > 0) {
      let stockHtml = '<div class="store-stock-table-wrapper"><table class="store-stock-table"><thead><tr><th>店舗名</th><th style="text-align:right;">セット可能数</th></tr></thead><tbody>';
      for (const [store, val] of Object.entries(calcStock)) {
        const num = val;
        const classText = num > 0 ? 'positive' : 'zero';
        stockHtml += `<tr><td>${store}</td><td class="store-stock-val ${classText}">${num} 点</td></tr>`;
      }
      stockHtml += '</tbody></table></div>';
      storeStockContainer.innerHTML = stockHtml;
      storeStockSection.style.display = 'block';
    } else {
      storeStockSection.style.display = 'none';
    }
  } else {
    if (product['店在庫'] && Object.keys(product['店在庫']).length > 0) {
      let stockHtml = '<div class="store-stock-table-wrapper"><table class="store-stock-table"><thead><tr><th>店舗名</th><th style="text-align:right;">在庫数</th></tr></thead><tbody>';
      for (const [store, val] of Object.entries(product['店在庫'])) {
        const num = parseInt(val, 10) || 0;
        const classText = num > 0 ? 'positive' : 'zero';
        stockHtml += `<tr><td>${store}</td><td class="store-stock-val ${classText}">${num} 点</td></tr>`;
      }
      stockHtml += '</tbody></table></div>';
      storeStockContainer.innerHTML = stockHtml;
      storeStockSection.style.display = 'block';
    } else {
      storeStockSection.style.display = 'none';
    }
  }

  // Manual PDF Links (Check IndexedDB first, then fallback to URL)
  const manualSection = document.getElementById('manual');
  const manualBox = document.getElementById('detailManualBox');
  pdfStore.getPdf(product['商品番号']).then(record => {
    if (record && record.blob) {
      const localUrl = URL.createObjectURL(record.blob);
      manualSection.style.display = 'block';
      manualBox.style.display = 'flex';
      manualBox.onclick = () => window.open(localUrl, '_blank');
      manualBox.querySelector('.link-box-title').innerText = record.fileName || '取扱説明書・組立説明書 (ローカル保存)';
    } else {
      const pdfUrl = getProductSpec(product, '取扱説明書PDF');
      if (pdfUrl) {
        manualSection.style.display = 'block';
        manualBox.style.display = 'flex';
        manualBox.onclick = () => window.open(pdfUrl, '_blank');
        manualBox.querySelector('.link-box-title').innerText = '取扱説明書・組立説明書.pdf';
      } else {
        manualSection.style.display = 'none';
        manualBox.style.display = 'none';
      }
    }
  }).catch(err => {
    console.error("Failed to read IndexedDB PDF:", err);
    const pdfUrl = getProductSpec(product, '取扱説明書PDF');
    if (pdfUrl) {
      manualSection.style.display = 'block';
      manualBox.style.display = 'flex';
      manualBox.onclick = () => window.open(pdfUrl, '_blank');
    } else {
      manualSection.style.display = 'none';
      manualBox.style.display = 'none';
    }
  });

  // Video embeds
  const videoSection = document.getElementById('detailVideoSection');
  const assemblyVideo = getProductSpec(product, '組立動画URL');
  const usageVideo = getProductSpec(product, '使用動画URL');
  const cautionVideo = getProductSpec(product, '注意動画URL');
  
  let videoCount = 0;
  let videoHtml = '';

  if (assemblyVideo) {
    videoCount++;
    videoHtml += `
      <div style="margin-bottom: 16px;">
        <span class="spec-label" style="display:block; margin-bottom: 6px; font-weight:700;">■ 組立説明動画</span>
        <div class="video-wrapper">
          <iframe src="${formatVideoEmbedUrl(assemblyVideo)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
        </div>
      </div>
    `;
  }

  if (usageVideo) {
    videoCount++;
    videoHtml += `
      <div style="margin-bottom: 16px;">
        <span class="spec-label" style="display:block; margin-bottom: 6px; font-weight:700;">■ 使用イメージ・紹介動画</span>
        <div class="video-wrapper">
          <iframe src="${formatVideoEmbedUrl(usageVideo)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
        </div>
      </div>
    `;
  }

  if (cautionVideo) {
    videoCount++;
    videoHtml += `
      <div>
        <span class="spec-label" style="display:block; margin-bottom: 6px; font-weight:700; color: var(--color-status-danger);">■ 注意事項説明動画</span>
        <div class="video-wrapper">
          <iframe src="${formatVideoEmbedUrl(cautionVideo)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
        </div>
      </div>
    `;
  }

  if (videoCount > 0) {
    videoSection.style.display = 'block';
    document.getElementById('videoContainer').innerHTML = videoHtml;
  } else {
    videoSection.style.display = 'none';
  }

  // Related Products cards
  const relatedSection = document.getElementById('detailRelatedSection');
  const relatedGrid = document.getElementById('relatedGrid');
  const relatedSkus = product['関連商品'];

  if (relatedSkus) {
    const skuArray = relatedSkus.split(',').map(s => s.trim()).filter(Boolean);
    let cardsHtml = '';
    let foundCount = 0;

    skuArray.forEach(relSku => {
      const relProduct = SearchEngine.findById(relSku);
      if (relProduct) {
        foundCount++;
        cardsHtml += `
          <div class="related-card" onclick="showProductDetails('${relProduct['商品番号']}')">
            <span class="related-sku">${relProduct['商品番号']}</span>
            <span class="related-name">${relProduct['商品名']}</span>
            <span class="related-price">${formatPrice(relProduct['価格'])}</span>
          </div>
        `;
      }
    });

    if (foundCount > 0) {
      relatedSection.style.display = 'block';
      relatedGrid.innerHTML = cardsHtml;
    } else {
      relatedSection.style.display = 'none';
    }
  } else {
    relatedSection.style.display = 'none';
  }

  // Reset tab active state and scroll to top of details page
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => btn.classList.remove('active'));
  tabBtns[0].classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' });
};

// Help helper if image source fails to load
window.imgLoadError = function(img) {
  img.style.display = 'none';
  const parent = img.parentElement;
  parent.innerHTML = `
    <div class="detail-img-fallback">
      <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/></svg>
      <span>画像を読み込めませんでした</span>
    </div>`;
};

// Format embed links (especially Youtube normal link to embed link)
function formatVideoEmbedUrl(url) {
  if (!url) return '';
  if (url.includes('youtube.com/embed/')) return url;
  if (url.includes('youtu.be/')) {
    const id = url.split('/').pop().split('?')[0];
    return `https://www.youtube.com/embed/${id}`;
  }
  if (url.includes('youtube.com/watch')) {
    const urlObj = new URL(url);
    const id = urlObj.searchParams.get('v');
    return `https://www.youtube.com/embed/${id}`;
  }
  return url;
}

// Go back to top / home screen
window.goBackToHome = function() {
  APP_STATE.currentView = 'home';
  APP_STATE.currentProductId = null;
  
  document.getElementById('detailsView').style.display = 'none';
  document.getElementById('dashboardView').style.display = 'block';
  
  // Clear search query
  document.getElementById('searchInput').value = '';
  document.getElementById('searchClear').style.display = 'none';
  document.getElementById('suggestions').style.display = 'none';
  
  window.scrollTo({ top: 0, behavior: 'instant' });
};

// ==========================================================================
// CAMERA BARCODE SCANNER LOGIC (Using Html5Qrcode)
// ==========================================================================
function startCameraScanner() {
  // Let the user know the camera is starting
  const helpText = document.querySelector('.scanner-help-text');
  helpText.innerText = 'カメラを起動中...';
  
  // Initialize camera scanner container size
  // Delay slightly to allow modal open animation to settle
  setTimeout(() => {
    if (APP_STATE.html5Qrcode) {
      stopCameraScanner(); // clean reset
    }
    
    // Create new reader instance
    APP_STATE.html5Qrcode = new Html5Qrcode("reader");
    
    const config = { 
      fps: 15, 
      qrbox: function(width, height) {
        // Ideal barcode bounding box (wide aspect ratio rather than square)
        const boxWidth = Math.floor(width * 0.8);
        const boxHeight = Math.floor(height * 0.4);
        return {
          width: boxWidth,
          height: boxHeight
        };
      },
      aspectRatio: 1.0
    };

    // Trigger camera scan
    // FacingMode 'environment' targets back camera on phones
    APP_STATE.html5Qrcode.start(
      { facingMode: "environment" },
      config,
      onScanSuccess,
      onScanFailure
    ).then(() => {
      helpText.innerText = 'JANコード/バーコードを枠内に収めてください';
    }).catch(err => {
      console.error("Camera start failed", err);
      helpText.innerHTML = `<span style="color:var(--color-status-danger)">カメラ起動失敗。パーミッションを確認してください。</span>`;
    });
  }, 350);
}

function stopCameraScanner() {
  if (APP_STATE.html5Qrcode) {
    APP_STATE.html5Qrcode.stop().then(() => {
      console.log("Scanner stopped successfully.");
      APP_STATE.html5Qrcode = null;
    }).catch(err => {
      console.warn("Failed to stop scanner", err);
      APP_STATE.html5Qrcode = null;
    });
  }
}

// Scanned string callback
function onScanSuccess(decodedText, decodedResult) {
  console.log(`Scan matched: ${decodedText}`, decodedResult);
  
  // Vibrate phone to notify staff
  if (navigator.vibrate) {
    navigator.vibrate(150);
  }
  
  // Close camera scanner
  closeModal('scannerModal');
  
  // Put scanned value to search bar
  const searchInput = document.getElementById('searchInput');
  searchInput.value = decodedText;
  document.getElementById('searchClear').style.display = 'block';
  
  // Perform search
  const product = SearchEngine.findByJan(decodedText) || SearchEngine.findById(decodedText);
  if (product) {
    showProductDetails(product['商品番号']);
  } else {
    // If not found in database, do a generic query search
    const results = SearchEngine.search(decodedText);
    if (results.length > 0) {
      showProductDetails(results[0]['商品番号']);
    } else {
      showNotification(`バーコード "${decodedText}" に一致する商品は見つかりませんでした。`, 'warning');
    }
  }
}

function onScanFailure(error) {
  // Silent fail - html5Qrcode calls this constantly while looking for codes
}

// Simulation/Mock scan buttons for testing without mobile camera
window.triggerMockScan = function(barcodeValue) {
  console.log(`Mocking barcode scan for: ${barcodeValue}`);
  closeModal('scannerModal');
  
  const searchInput = document.getElementById('searchInput');
  searchInput.value = barcodeValue;
  document.getElementById('searchClear').style.display = 'block';
  
  const product = SearchEngine.findByJan(barcodeValue) || SearchEngine.findById(barcodeValue);
  if (product) {
    showProductDetails(product['商品番号']);
  } else {
    showNotification(`バーコード "${barcodeValue}" に一致する商品は見つかりませんでした。`, 'warning');
  }
};

// ==========================================================================
// MULTI-MASTER IMPORT UI BINDINGS
// ==========================================================================
function initializeMasterImportUI() {
  const masterImportBtn = document.getElementById('masterImportBtn');
  if (masterImportBtn) {
    masterImportBtn.addEventListener('click', () => {
      openModal('masterImportModal');
      updateMasterSyncBadges();
      updateVideoUrlBadge();
    });
  }

  // Master file inputs change events
  const fileInputs = document.querySelectorAll('.master-file-input');
  fileInputs.forEach(input => {
    input.addEventListener('change', (e) => {
      const type = input.getAttribute('data-master');
      const file = e.target.files[0];
      if (file) {
        handleMasterFileSelect(type, file);
      }
    });
  });

  // Clear all masters button
  const clearAllMasterBtn = document.getElementById('clearAllMasterBtn');
  if (clearAllMasterBtn) {
    clearAllMasterBtn.addEventListener('click', () => {
      if (confirm('すべての登録商品データと動画 URL を完全に削除しますか？')) {
        localStorage.removeItem(STORAGE_KEYS.PRODUCTS);
        APP_STATE.products = [];
        SearchEngine.updateData([]);
        
        APP_STATE.config.masterSyncs = {};
        saveConfig();

        pdfStore.clearAllPdfs().then(() => {
          updateVideoUrlBadge();
        }).catch(err => console.error(err));

        updateMasterSyncBadges();
        updateDashboardStats();
        
        showNotification('すべてのマスタデータを削除しました。初期データを読み込みます。');
        fetchBundledCsv();
      }
    });
  }

  // Video URL file upload listener
  const videoUrlFileInput = document.getElementById('videoUrlFileInput');
  if (videoUrlFileInput) {
    videoUrlFileInput.addEventListener('change', (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      let processedCount = 0;
      const promises = Array.from(files).map(file => {
        return new Promise((resolve) => {
          const fileName = file.name.substring(0, file.name.lastIndexOf('.')).trim();
          
          let type = '';
          if (fileName.includes('組立')) type = '組立動画URL';
          else if (fileName.includes('使用')) type = '使用動画URL';
          else if (fileName.includes('注意')) type = '注意動画URL';

          let sku = '';
          const underscoreIdx = fileName.indexOf('_');
          if (underscoreIdx !== -1) {
            sku = fileName.substring(0, underscoreIdx).trim();
          } else {
            const match = fileName.match(/^([a-zA-Z0-9-_]+?)(組立|使用|注意)/);
            if (match && match[1]) {
              sku = match[1].trim();
            } else {
              sku = fileName;
            }
          }

          if (!sku || !type) return resolve();

          const reader = new FileReader();
          reader.onload = function(evt) {
            let url = evt.target.result.trim();
            if (url.includes('URL=')) {
              const match = url.match(/URL=(https?:\/\/[^\s\r\n]+)/i);
              if (match && match[1]) {
                url = match[1];
              }
            }

            if (url.startsWith('http://') || url.startsWith('https://')) {
              let idx = APP_STATE.products.findIndex(p => p['商品番号'].toLowerCase() === sku.toLowerCase());
              if (idx === -1) {
                const newProduct = {
                  '商品番号': sku,
                  'JANコード': '',
                  '商品名': '',
                  '価格': '',
                  '在庫数': '0',
                  'カラー': '',
                  'サイズ': '',
                  '重量': '',
                  '送料区分': '',
                  '梱包サイズ': '',
                  '商品説明': '',
                  '素材': '',
                  '耐荷重': '',
                  '注意事項': '',
                  '保証期間': '',
                  '組立時間': '',
                  '組立人数': '',
                  '関連商品': '',
                  '取扱説明書PDF': '',
                  '組立動画URL': '',
                  '使用動画URL': '',
                  '注意動画URL': '',
                  '商品画像': '',
                  'isSetProduct': false,
                  'components': []
                };
                APP_STATE.products.push(newProduct);
                idx = APP_STATE.products.length - 1;
              }
              APP_STATE.products[idx][type] = url;
              processedCount++;
            }
            resolve();
          };
          reader.readAsText(file, 'UTF-8');
        });
      });

      Promise.all(promises).then(() => {
        localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(APP_STATE.products));
        SearchEngine.updateData(APP_STATE.products);
        updateVideoUrlBadge();
        updateDashboardStats();
        showNotification(`${processedCount}件の動画URLを個別に紐付け・インポートしました`);
      });
    });
  }

  // Export merged CSV button
  const exportMergedCsvBtn = document.getElementById('exportMergedCsvBtn');
  if (exportMergedCsvBtn) {
    exportMergedCsvBtn.addEventListener('click', exportDatabaseToCsv);
  }
}

// Export current merged database to a single CSV file
function exportDatabaseToCsv() {
  if (APP_STATE.products.length === 0) {
    showNotification('出力するデータがありません。', 'error');
    return;
  }
  
  const headers = [
    '商品番号', 'JANコード', '商品名', '価格', '在庫数', 'カラー', 
    'サイズ', '重量', '送料区分', '梱包サイズ', '商品説明', '素材', 
    '耐荷重', '注意事項', '保証期間', '組立時間', '組立人数', 
    '関連商品', '取扱説明書PDF', '組立動画URL', '使用動画URL', '注意動画URL', '商品画像', 'isSetProduct', 'components', '店在庫'
  ];
  
  // UTF-8 BOM
  let csvContent = '\uFEFF' + headers.join(',') + '\n';
  
  APP_STATE.products.forEach(p => {
    const row = headers.map(h => {
      let val = p[h];
      if (val === undefined || val === null) {
        val = '';
      }
      if (typeof val === 'object') {
        val = JSON.stringify(val);
      }
      val = String(val).replace(/"/g, '""');
      if (val.includes(',') || val.includes('\n') || val.includes('"')) {
        val = `"${val}"`;
      }
      return val;
    });
    csvContent += row.join(',') + '\n';
  });
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `bodymaker_merged_data.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showNotification('統合CSVファイルを出力しました');
}

// ==========================================================================
// MASTER EXCEL/CSV FILE SELECT & PARSING
// ==========================================================================
function handleMasterFileSelect(masterType, file) {
  const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
  const reader = new FileReader();

  reader.onload = function(evt) {
    if (isExcel) {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const csvText = XLSX.utils.sheet_to_csv(worksheet);
        mergeMasterFile(masterType, csvText);
      } catch (err) {
        console.error(err);
        showNotification('Excelファイルの読み込みに失敗しました。', 'error');
      }
    } else {
      const text = evt.target.result;
      // Auto-detect Shift_JIS encoding
      if (text.includes('\uFFFD')) {
        const sjisReader = new FileReader();
        sjisReader.onload = function(sjisEvt) {
          mergeMasterFile(masterType, sjisEvt.target.result);
        };
        sjisReader.readAsText(file, 'Shift_JIS');
      } else {
        mergeMasterFile(masterType, text);
      }
    }
  };

  if (isExcel) {
    reader.readAsArrayBuffer(file);
  } else {
    reader.readAsText(file, 'UTF-8');
  }
}

// Helper to normalize column headers (strip spaces, quotes, footnotes, brackets)
function normalizeHeader(h) {
  if (!h) return '';
  let str = h.trim();
  
  // Standard half-width to full-width mapping for Japanese import terms
  str = str.replace(/ｾｯﾄ/g, 'セット')
           .replace(/ｺｰﾄﾞ/g, 'コード')
           .replace(/ｺｰﾄ/g, 'コード')
           .replace(/名/g, '名')
           .replace(/品番/g, '品番')
           .replace(/親/g, '親')
           .replace(/商品/g, '商品')
           .replace(/構成/g, '構成')
           .replace(/数量/g, '数量')
           .replace(/個数/g, '数量')
           .replace(/耐荷重/g, '耐荷重')
           .replace(/耐荷重量/g, '耐荷重')
           .replace(/外部ID/g, '外部ID')
           .replace(/JAN/g, 'JAN')
           .replace(/UPC/g, 'UPC')
           .replace(/時間/g, '時間')
           .replace(/人数/g, '人数')
           .replace(/画像/g, '画像')
           .replace(/動画/g, '動画');
           
  // Clean punctuation, asterisks, brackets, quotes, footnotes (like ')
  str = str.replace(/[\*’\'\"ﾞﾟ\s]/g, '');
  
  // Preserve 1名/2名 assembly specifiers before removing brackets
  if (str.includes('組立時間') || str.includes('組立目安')) {
    str = str.replace(/[（\uff08]([1１])名[）\uff09]/g, '1名')
             .replace(/[（\uff08]([2２])名[）\uff09]/g, '2名')
             .replace(/[（\uff08]([2２])名～[）\uff09]/g, '2名')
             .replace(/[（\uff08]([2２])名~[）\uff09]/g, '2名');
  } else {
    // Remove trailing footnotes or brackets content like (cm) or (kg)
    str = str.replace(/[\(\uff08].*?[\)\uff09]/g, '');
  }
  
  return str;
}

// ==========================================================================
// DATA MERGING CORE ALGORITHM
// ==========================================================================
function mergeMasterFile(masterType, csvText) {
  // Strip BOM if present
  if (csvText && csvText.startsWith('\ufeff')) {
    csvText = csvText.slice(1);
  }

  Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: function(h) {
      return normalizeHeader(h);
    },
    complete: function(results) {
      if (!results.data || results.data.length === 0) {
        showNotification('解析したレコードが空です。', 'error');
        return;
      }

      // If importing set composition, clear components array of sets present in the file
      if (masterType === 'setCompositionMaster') {
        const setsInFile = new Set();
        results.data.forEach(row => {
          const setSku = (row['セット商品コード'] || row['ｾｯﾄ商品ｺｰﾄﾞ'] || row['セット品番'] || row['ｾｯﾄ品番'] || '').trim();
          if (setSku) setsInFile.add(setSku.toLowerCase());
        });
        APP_STATE.products.forEach(p => {
          if (p['商品番号'] && setsInFile.has(p['商品番号'].toLowerCase())) {
            p.components = [];
            p.isSetProduct = true;
          }
        });
      }

      let updatedCount = 0;
      let addedCount = 0;

      // Helper to find existing products by SKU or JAN (exact, or by 5-char prefix if allowed)
      const findProductIndexes = (sku, jan, allowPrefixMatch = true) => {
        const indexes = [];
        
        if (sku) {
          const skuLower = sku.toLowerCase();
          
          APP_STATE.products.forEach((p, idx) => {
            const pSku = (p['商品番号'] || '').toLowerCase();
            
            // Exact match
            if (pSku === skuLower) {
              indexes.push(idx);
              return;
            }
            
            if (allowPrefixMatch) {
              const skuPrefix5 = skuLower.substring(0, 5);
              const pSkuPrefix5 = pSku.substring(0, 5);
              
              // Prefix 5-char match: only if both SKUs are at least 5 chars long!
              if (skuLower.length >= 5 && pSku.length >= 5 && pSkuPrefix5 === skuPrefix5) {
                indexes.push(idx);
                return;
              }
              
              // Substring match: if one of them is exactly 5 characters and is a prefix of the other!
              if (skuLower.length === 5 && pSku.startsWith(skuLower)) {
                indexes.push(idx);
                return;
              }
              if (pSku.length === 5 && skuLower.startsWith(pSku)) {
                indexes.push(idx);
                return;
              }
            }
          });
        }
        
        if (indexes.length > 0) {
          return Array.from(new Set(indexes));
        }
        
        if (jan) {
          APP_STATE.products.forEach((p, idx) => {
            if ((p['JANコード'] || '') === jan) {
              indexes.push(idx);
            }
          });
        }
        
        return indexes;
      };

      results.data.forEach(row => {
        // Extract common identifier values from typical column names
        let skuVal = (row['商品番号'] || row['品番'] || row['商品コード'] || row['外部ID'] || row['親コード'] || '').trim();
        let janVal = (row['JANコード'] || row['UPCコード'] || row['JAN'] || '').trim();

        if (masterType === 'setCompositionMaster') {
          skuVal = (row['セット商品コード'] || row['ｾｯﾄ商品ｺｰﾄﾞ'] || row['セット品番'] || row['ｾｯﾄ品番'] || '').trim();
        }

        if (!skuVal && !janVal) return; // skip row if no identifier

        const allowPrefix = !['nsMaster', 'setCompositionMaster'].includes(masterType);
        let idxs = findProductIndexes(skuVal, janVal, allowPrefix);
        
        // If product doesn't exist, create it in the catalog immediately
        if (idxs.length === 0) {
          const pName = (
            row['表示名'] || 
            row['品名'] || 
            row['名前'] || 
            row['セット商品名'] || row['ｾｯﾄ商品名'] || 
            row['商品名'] || 
            ''
          ).trim();

          const newProduct = {
            '商品番号': skuVal || janVal, // fallback
            'JANコード': janVal,
            '商品名': pName,
            '価格': '',
            '在庫数': '0',
            'カラー': '',
            'サイズ': '',
            '重量': '',
            '送料区分': '',
            '梱包サイズ': '',
            '商品説明': '',
            '素材': '',
            '耐荷重': '',
            '注意事項': '',
            '保証期間': '',
            '組立時間': '',
            '組立人数': '',
            '関連商品': '',
            '取扱説明書PDF': '',
            '組立動画URL': '',
            '使用動画URL': '',
            '商品画像': '',
            'isSetProduct': masterType === 'setCompositionMaster',
            'components': []
          };
          APP_STATE.products.push(newProduct);
          idxs = [APP_STATE.products.length - 1];
          addedCount++;
        }

        idxs.forEach(idx => {
          const product = APP_STATE.products[idx];
          updatedCount++;

          // Apply merge mapping
          if (masterType === 'nsMaster') {
            if (skuVal) product['商品番号'] = skuVal;
            if (janVal) product['JANコード'] = janVal;
            product['商品名'] = row['表示名'] || row['名前'] || row['品名'] || product['商品名'] || '';
            product['価格'] = row['オンライン価格'] || row['オンライン'] || row['価格'] || product['価格'] || '';
            product['在庫数'] = row['最小可能数'] || row['在庫数'] || product['在庫数'] || '0';
            product['送料区分'] = row['送料種別'] || row['送料区分'] || product['送料区分'] || '';
          } 
          else if (masterType === 'setCompositionMaster') {
            product.isSetProduct = true;
            if (!product.components) product.components = [];
            
            const compSku = (row['構成商品コード'] || row['構成商品ｺｰﾄﾞ'] || row['構成品番'] || '').trim();
            const compName = (row['構成商品名'] || row['構成商品名'] || '').trim();
            const compQty = parseInt(row['構成数量'] || row['構成数量'] || row['個数'] || row['数量'] || '1', 10);
            
            if (compSku) {
              const compIdx = product.components.findIndex(c => c.sku.toLowerCase() === compSku.toLowerCase());
              if (compIdx === -1) {
                product.components.push({
                  sku: compSku,
                  name: compName,
                  quantity: compQty
                });
              } else {
                product.components[compIdx].name = compName;
                product.components[compIdx].quantity = compQty;
              }
            }
            const setName = (row['セット商品名'] || row['ｾｯﾄ商品名'] || '').trim();
            if (setName) {
              product['商品名'] = setName;
            }
          }
          else if (masterType === 'storeStockMaster') {
            // Dynamic store stock starting from column 5 onwards
            if (!product['店在庫']) product['店在庫'] = {};
            
            Object.keys(row).forEach(header => {
              const h = header.trim();
              if (['親コード', 'JAN', '品番', '品名', 'オンライン', '商品番号', '商品コード', '外部ID', 'セット商品コード', 'セット商品名'].includes(h)) {
                return;
              }
              if (h) {
                product['店在庫'][h] = row[header] || '0';
              }
            });
          } 
          else if (masterType === 'specsMaster') {
            product['カラー'] = row['カラー'] || product['カラー'] || '';
            product['サイズ'] = row['サイズ'] || product['サイズ'] || '';
            product['重量'] = row['本体重量'] || row['重量'] || product['重量'] || '';
            product['商品説明'] = row['説明'] || row['商品説明'] || product['商品説明'] || '';
            product['素材'] = row['素材'] || product['素材'] || '';
            product['注意事項'] = row['注意'] || row['注意事項'] || product['注意事項'] || '';
            product['保証期間'] = row['保証有無'] || row['保証期間'] || product['保証期間'] || '';
          } 
          else if (masterType === 'packageMaster') {
            const w = (row['幅'] || row['幅 (cm)'] || '').trim();
            const l = (row['長'] || row['長 (cm)'] || '').trim();
            const h = (row['高'] || row['高 (cm)'] || '').trim();
            const kg = (row['重量'] || row['重量 kg'] || '').trim();
            if (w || l || h) {
              product['梱包サイズ'] = `幅${w}×奥行${l}×高さ${h}cm` + (kg ? ` (重量:${kg}kg)` : '');
            }
          } 
          else if (masterType === 'capacityMaster') {
            product['耐荷重'] = row['耐荷重'] || row['耐荷重量'] || product['耐荷重'] || '';
          } 
          else if (masterType === 'assemblyMaster') {
            const t1 = (row['組立時間目安1名'] || row['組立時間1名'] || row['組立所要時間1名'] || '').trim();
            const t2 = (row['組立時間目安2名'] || row['組立時間2名'] || row['組立所要時間2名'] || '').trim();
            
            if (t1 && t2) {
              product['組立時間'] = `${t1}分 (1名) / ${t2}分 (2名)`;
              product['組立人数'] = '1〜2名';
            } else if (t1) {
              product['組立時間'] = `${t1}分`;
              product['組立人数'] = '1名';
            } else if (t2) {
              product['組立時間'] = `${t2}分`;
              product['組立人数'] = '2名';
            } else {
              product['組立時間'] = row['組立時間'] || row['組立所要時間'] || row['組立時間目安'] || product['組立時間'] || '';
              product['組立人数'] = row['組立人数'] || product['組立人数'] || '';
            }
          } 
          else if (masterType === 'manualMaster') {
            product['取扱説明書PDF'] = row['URL'] || row['取扱説明書PDF'] || product['取扱説明書PDF'] || '';
          } 
          else if (masterType === 'videoMaster') {
            product['組立動画URL'] = row['組立動画URL'] || product['組立動画URL'] || '';
            product['使用動画URL'] = row['使用動画URL'] || product['使用動画URL'] || '';
            product['商品画像'] = row['商品画像'] || product['商品画像'] || '';
          }
        });
      }); // ends results.data.forEach

      // Save merged database to localStorage
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(APP_STATE.products));
      SearchEngine.updateData(APP_STATE.products);

      // Record Sync Log
      const now = new Date();
      const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (!APP_STATE.config.masterSyncs) APP_STATE.config.masterSyncs = {};
      APP_STATE.config.masterSyncs[masterType] = {
        rowCount: updatedCount,
        timestamp: timeStr
      };
      saveConfig();

      updateMasterSyncBadges();
      updateDashboardStats();
      
      let countMsg = `${updatedCount}件の商品スペックを更新しました`;
      if (masterType === 'nsMaster') {
        countMsg = `${updatedCount}件更新、${addedCount}件新規追加しました`;
      } else if (masterType === 'setCompositionMaster') {
        countMsg = `${updatedCount}件のセット構成をインポートし、${addedCount}件のセット品を新規登録しました`;
      }
      showNotification(`同期完了: ${countMsg}`);
    },
    error: function(err) {
      console.error(err);
      showNotification('マスタの解析に失敗しました。', 'error');
    }
  });
}

// ==========================================================================
// SYNC BADGE DISPLAY RENDERING
// ==========================================================================
function updateMasterSyncBadges() {
  const syncs = APP_STATE.config.masterSyncs || {};
  const masterTypes = [
    'nsMaster', 'setCompositionMaster', 'storeStockMaster', 'specsMaster', 'packageMaster', 
    'capacityMaster', 'assemblyMaster', 'manualMaster', 'videoMaster'
  ];

  masterTypes.forEach(type => {
    const badge = document.getElementById(`sync_${type}`);
    if (badge && syncs[type]) {
      badge.className = 'master-sync-badge badge-ok';
      badge.innerText = `${syncs[type].rowCount}件 (${syncs[type].timestamp})`;
    } else if (badge) {
      badge.className = 'master-sync-badge badge-empty';
      badge.innerText = '未同期';
    }
  });
}

function updateVideoUrlBadge() {
  let count = 0;
  APP_STATE.products.forEach(p => {
    if (p['組立動画URL'] || p['使用動画URL'] || p['注意動画URL']) {
      count++;
    }
  });
  const badge = document.getElementById('sync_videoUrlCount');
  if (badge) {
    badge.innerText = `登録済: ${count} 件`;
  }
}
