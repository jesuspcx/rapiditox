/**
 * Rapidito · capa de presentación
 * Renderiza las vistas y gestiona las piezas de interfaz (sheet, dialog,
 * sugerencias). El controlador (app.js) decide qué renderizar.
 *
 * Todo dato externo se escapa antes de entrar al DOM.
 */

import { APP_CONFIG } from './config.js';
import {
  fareTotalInBolivares,
  formatBolivares,
  formatRate,
  formatRateDate,
  formatShortDate,
  formatUsd,
  formatUsdFare,
  normalFareInBolivares,
  studentFareInBolivares,
} from './money.js';

const ICON_NAMES = new Set([
  'arrow-left', 'arrow-right', 'bus', 'building', 'check', 'chevron-right',
  'clock', 'close', 'download', 'external', 'info', 'landmark', 'layers',
  'locate', 'map', 'menu', 'moon', 'pin', 'plaza', 'refresh', 'route',
  'search', 'shield', 'sun', 'ticket', 'town', 'walk', 'x', 'sparkle',
]);

const PLACE_ICONS = new Set(['building', 'bus', 'town', 'landmark', 'plaza']);

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function icon(name, className = 'icon') {
  const safeName = ICON_NAMES.has(name) ? name : 'pin';
  return `<svg class="${className}" aria-hidden="true" focusable="false"><use href="#icon-${safeName}"></use></svg>`;
}

function logoMark(className = 'logo-rapidito') {
  return `<svg class="${className}" viewBox="0 0 1080 1080" aria-hidden="true" focusable="false"><use href="#logo-rapidito"></use></svg>`;
}

function formatDistance(meters) {
  const value = Number(meters);
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.max(10, Math.round(value / 10) * 10)} m`;
  return `${new Intl.NumberFormat('es-VE', { maximumFractionDigits: 1 }).format(value / 1000)} km`;
}

function minuteLabel(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  return `${value} min`;
}

function linePill(groupId, color, extraClass = '') {
  return `<span class="line-pill ${extraClass}" style="--line-color:${escapeHtml(color)}">${escapeHtml(groupId)}</span>`;
}

function farePriceMarkup(label, fareUsd, fareBs) {
  return `<span class="fare-price">
    <span class="fare-price__label">${escapeHtml(label)}</span>
    <strong class="fare-price__amount">${fareBs === null ? 'Bs. —' : formatBolivares(fareBs)}</strong>
    <span class="fare-price__usd">${formatUsdFare(fareUsd)} · tasa BCV</span>
  </span>`;
}

const MAX_FARE_QUANTITY = 99;

function clampFareQuantity(value) {
  return Math.min(MAX_FARE_QUANTITY, Math.max(0, Math.floor(Number(value) || 0)));
}

function fareQuantityDetail(normal, student) {
  if (!normal && !student) return 'Elige tus pasajes';
  const parts = [];
  if (normal) parts.push(`${normal} ${normal === 1 ? 'normal' : 'normales'}`);
  if (student) parts.push(`${student} ${student === 1 ? 'estudiantil' : 'estudiantiles'}`);
  return parts.join(' + ');
}

function fareQuantityRowMarkup(type, label, fareUsd, fareBs, quantity) {
  const qty = clampFareQuantity(quantity);
  const unit = fareBs === null ? 'Bs. —' : formatBolivares(fareBs);
  const isNormal = type === 'normal';
  return `<div class="fare-qty">
    <div class="fare-qty__info">
      <strong>${escapeHtml(label)}</strong>
      <span>${unit} c/u · ${formatUsdFare(fareUsd)}</span>
    </div>
    <div class="fare-qty__controls">
      <button type="button" class="fare-qty__button" data-action="change-fare-quantity"
        data-fare-type="${type}" data-delta="-1"
        aria-label="Quitar un pasaje ${isNormal ? 'normal' : 'estudiantil'}"
        ${qty <= 0 ? 'disabled' : ''}>−</button>
      <span class="fare-qty__value" data-fare-quantity="${type}"
        aria-label="Cantidad de pasajes ${isNormal ? 'normales' : 'estudiantiles'}">${qty}</span>
      <button type="button" class="fare-qty__button" data-action="change-fare-quantity"
        data-fare-type="${type}" data-delta="1"
        aria-label="Agregar un pasaje ${isNormal ? 'normal' : 'estudiantil'}"
        ${qty >= MAX_FARE_QUANTITY ? 'disabled' : ''}>+</button>
    </div>
  </div>`;
}

function rateFooterButton(rateInfo) {
  const available = rateInfo && Number.isFinite(Number(rateInfo.rate));
  const normalBs = normalFareInBolivares(rateInfo?.rate);
  const studentBs = studentFareInBolivares(rateInfo?.rate);
  return `<button type="button" class="sheet-rate" data-action="open-fares" aria-haspopup="dialog">
    <span class="sheet-rate__head">
      <span class="sheet-rate__title">${icon('ticket', 'icon icon--tiny')} Pasajes de hoy</span>
      ${icon('chevron-right', 'icon icon--small')}
    </span>
    <span class="fare-price-grid">
      ${farePriceMarkup('Pasaje normal', APP_CONFIG.fares.normalUsd, normalBs)}
      ${farePriceMarkup('Pasaje estudiantil', APP_CONFIG.fares.studentUsd, studentBs)}
    </span>
    <span class="sheet-rate__rate">${available
      ? `Tasa BCV: Bs. ${formatRate(rateInfo.rate)} / USD`
      : 'Tasa BCV pendiente · toca para reintentar'}</span>
  </button>`;
}

function quickPlacesMarkup(places = []) {
  if (!places.length) return '';

  return `<section class="quick-places" aria-labelledby="quick-title">
    <div class="section-heading">
      <h2 id="quick-title">Atajos de hoy</h2>
    </div>
    <div class="quick-scroller" aria-label="Atajos de destino">
      ${places.slice(0, 5).map((place, index) => {
        const iconName = PLACE_ICONS.has(place.icono) ? place.icono : 'pin';
        return `<button type="button" class="quick-place"
          data-action="choose-quick-place" data-place-index="${index}">
          <span class="quick-place__icon">${icon(iconName)}</span>
          <span class="quick-place__text">
            <strong>${escapeHtml(place.nombre)}</strong>
            <small>${escapeHtml(place.detalle ?? APP_CONFIG.city.name)}</small>
          </span>
          ${icon('arrow-right', 'icon icon--tiny')}
        </button>`;
      }).join('')}
    </div>
  </section>`;
}

function sheetOriginNotice(origin, locationStatus) {
  if (locationStatus === 'locating') {
    return `<p class="inline-note">Mientras llega el GPS, ya puedes buscar tu destino.</p>`;
  }
  if (!origin || origin.source === 'demo') {
    return `<p class="inline-note inline-note--warning">
      ${icon('info', 'icon icon--tiny')}
      <span>El GPS no está disponible; usamos el centro de ${escapeHtml(APP_CONFIG.city.name)} como ubicación de muestra.</span>
      <button type="button" class="inline-link" data-action="refresh-location">Reintentar</button>
    </p>`;
  }
  return '';
}

function tripCard(candidate, index, selectedId, rateInfo) {
  const { route, boardStop, alightStop } = candidate;
  const fareUsd = APP_CONFIG.fares.normalUsd;
  const bsFare = normalFareInBolivares(rateInfo?.rate);
  const selected = candidate.id === selectedId;
  const closest = index === 0;
  const walking = candidate.walkingMinutes ?? Math.max(
    1,
    Math.round(candidate.walkToMinutes + candidate.walkFromMinutes),
  );
  const lineDistance = Number(candidate.originDistanceToLineM);

  return `<button type="button" class="trip-card ${selected ? 'is-selected' : ''}"
    style="--line-color:${escapeHtml(route.color)}"
    data-action="select-route" data-candidate-id="${escapeHtml(candidate.id)}"
    aria-pressed="${selected}">
    <span class="trip-card__head">
      ${linePill(route.groupId, route.color)}
      <span class="trip-card__identity">
        ${closest
          ? `<span class="closest-badge" title="La línea pasa a ${formatDistance(lineDistance)} de tu ubicación">
              ${icon('pin', 'icon icon--tiny')} Más cerca a ti
            </span>`
          : '<span class="trip-card__eyebrow">Otra opción</span>'}
        <strong class="trip-card__name">${escapeHtml(route.groupName)}</strong>
        <span class="trip-card__direction">Hacia ${escapeHtml(route.directionLabel)}</span>
      </span>
      <span class="trip-card__fare">
        <strong>${formatUsd(fareUsd)}</strong>
        <span>${bsFare === null ? 'Bs. —' : formatBolivares(bsFare)}</span>
      </span>
    </span>

    <span class="trip-card__metrics" aria-hidden="true">
      <span class="metric">${icon('walk', 'icon icon--tiny')}<strong>${minuteLabel(walking)}</strong><small>a pie</small></span>
      <span class="metric">${icon('bus', 'icon icon--tiny')}<strong>${minuteLabel(candidate.rideMinutes)}</strong><small>en ruta</small></span>
      <span class="metric">${icon('clock', 'icon icon--tiny')}<strong>≈ ${minuteLabel(candidate.totalMinutes)}</strong><small>total</small></span>
    </span>

    <span class="stop-sequence">
      <span class="stop-sequence__marker">1</span>
      <span class="stop-sequence__stop">
        <small>Sube · ${formatDistance(candidate.originWalkM)} a pie</small>
        <strong title="${escapeHtml(boardStop.name)}">${escapeHtml(boardStop.name)}</strong>
      </span>
      <span class="stop-sequence__arrow">${icon('arrow-right', 'icon icon--tiny')}</span>
      <span class="stop-sequence__marker stop-sequence__marker--end">2</span>
      <span class="stop-sequence__stop">
        <small>Baja · ${formatDistance(candidate.destinationWalkM)} a pie</small>
        <strong title="${escapeHtml(alightStop.name)}">${escapeHtml(alightStop.name)}</strong>
      </span>
    </span>

    <span class="trip-card__foot">
      <span class="direction-badge">${icon('check', 'icon icon--tiny')} Sentido verificado</span>
      <span>Espera ~${minuteLabel(candidate.waitMinutes)} · cada ${minuteLabel(candidate.frequencyMin)}</span>
      ${icon('chevron-right', 'icon icon--tiny trip-card__chevron')}
    </span>
  </button>`;
}

function quickPlacesInEmpty(places) {
  if (!places?.length) return '';
  return `<div class="empty-suggestions">
    <span class="empty-suggestions__label">Prueba con</span>
    ${places.slice(0, 3).map((place, index) => `
      <button type="button" class="ghost-chip" data-action="choose-quick-place" data-place-index="${index}">
        ${icon('pin', 'icon icon--tiny')}${escapeHtml(place.nombre)}
      </button>
    `).join('')}
  </div>`;
}

export function createUI() {
  const el = {
    boot: document.getElementById('boot'),
    bootStatus: document.getElementById('boot-status'),
    sheet: document.getElementById('sheet'),
    sheetContent: document.getElementById('sheet-content'),
    searchForm: document.getElementById('search-form'),
    searchInput: document.getElementById('search-input'),
    clearSearch: document.getElementById('clear-search'),
    locateButton: document.getElementById('locate-button'),
    suggestions: document.getElementById('search-suggestions'),
    menuButton: document.getElementById('menu-button'),
    dialogRoot: document.getElementById('dialog-root'),
    dialogPanel: document.getElementById('dialog-panel'),
    dialogKicker: document.getElementById('dialog-kicker'),
    dialogTitle: document.getElementById('dialog-title'),
    dialogBody: document.getElementById('dialog-body'),
    dialogClose: document.getElementById('dialog-close'),
    themeMeta: document.querySelector('meta[name="theme-color"]'),
  };

  let previousFocus = null;
  let sheetScrollMemory = 0;
  const fareQuantities = { normal: 0, student: 0 };
  let fareRateInfo = null;

  /* ------------------------------------------------------------------ */
  /* Boot                                                               */
  /* ------------------------------------------------------------------ */

  function setBootStatus(text) {
    if (el.bootStatus) el.bootStatus.textContent = text;
  }

  function hideBoot() {
    if (!el.boot || el.boot.hidden) return;
    el.boot.classList.add('is-hidden');
    window.setTimeout(() => {
      el.boot.hidden = true;
    }, 500);
  }

  /* ------------------------------------------------------------------ */
  /* Vistas principales                                                 */
  /* ------------------------------------------------------------------ */

  function notifyLayoutChange() {
    document.dispatchEvent(new CustomEvent('rapidito:layoutchange'));
  }

  function setSheet(html, { view = 'default', preserveScroll = false } = {}) {
    if (!el.sheetContent) return;
    if (preserveScroll) sheetScrollMemory = el.sheetContent.scrollTop;
    el.sheet.dataset.view = view;
    el.sheetContent.innerHTML = html;
    el.sheetContent.scrollTop = preserveScroll ? sheetScrollMemory : 0;
    window.requestAnimationFrame(() => {
      el.sheetContent.scrollTo({ top: el.sheetContent.scrollTop });
      notifyLayoutChange();
    });
  }

  function renderLoadingView() {
    setSheet(`<section class="loading-view" aria-live="polite">
      <div class="skeleton skeleton--eyebrow"></div>
      <div class="skeleton skeleton--title"></div>
      <div class="skeleton skeleton--line"></div>
      <div class="skeleton skeleton--card"></div>
    </section>`, { view: 'loading' });
  }

  function renderErrorView({ title, message, actionLabel = 'Reintentar', action = 'retry-routes' }) {
    setSheet(`<section class="error-view">
      <div class="empty-icon empty-icon--warning">${icon('route')}</div>
      <p class="eyebrow eyebrow--plain">Algo no cargó</p>
      <h2>${escapeHtml(title)}</h2>
      <p class="empty-copy">${escapeHtml(message)}</p>
      <button type="button" class="button button--primary" data-action="${escapeHtml(action)}">
        ${icon('refresh', 'icon icon--small')} ${escapeHtml(actionLabel)}
      </button>
      <p class="micro-credit">Rapidito necesita conexión la primera vez para guardar la red en tu dispositivo.</p>
    </section>`, { view: 'error' });
  }

  function renderIdle({
    origin,
    locationStatus = 'locating',
    places = [],
    rateInfo = null,
    rateLoading = false,
    network = null,
    offline = false,
  }) {
    const lineCount = network?.groups?.length ?? 0;
    const networkEmpty = lineCount === 0;

    setSheet(`<section class="idle-view">
      ${quickPlacesMarkup(places)}
      ${sheetOriginNotice(origin, locationStatus)}

      <div class="sheet-footer ${offline ? 'is-offline' : ''}">
        ${rateLoading
          ? `<span class="sheet-rate sheet-rate--loading"><span class="skeleton skeleton--rate"></span></span>`
          : rateFooterButton(rateInfo)}
        ${networkEmpty ? '' : `<button type="button" class="sheet-lines" data-action="open-lines">
          ${icon('layers', 'icon icon--small')}
          <span>
            <strong>${lineCount} líneas</strong>
            <small>Red local</small>
          </span>
        </button>`}
      </div>
    </section>`, { view: 'idle' });
  }

  function renderResults({
    origin,
    destination,
    candidates = [],
    selectedId = null,
    rateInfo = null,
    network = null,
    offline = false,
  }) {
    if (!candidates.length) return;
    const selected = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0];
    const destinationContext = destination?.context || 'Destino seleccionado';
    const originLabel = origin?.source === 'demo'
      ? `${APP_CONFIG.demo.label}`
      : 'Tu ubicación';
    const lineCount = new Set(candidates.map((candidate) => candidate.route.groupId)).size;
    // Al entrar desde el inicio/empty empezamos arriba; al cambiar de
    // alternativa o refrescar la tasa conservamos la posición del usuario.
    const preserveScroll = el.sheet.dataset.view === 'results';

    setSheet(`<section class="results-view">
      <div class="view-top">
        <button type="button" class="icon-button icon-button--soft" data-action="reset-search"
          aria-label="Cambiar destino">${icon('arrow-left')}</button>
        <div class="view-top__text">
          <p class="eyebrow eyebrow--plain">Rutas hacia</p>
          <h2 title="${escapeHtml(destination?.name ?? 'Tu destino')}">${escapeHtml(destination?.name ?? 'Tu destino')}</h2>
          <p>${escapeHtml(destinationContext)}</p>
        </div>
        <button type="button" class="icon-button icon-button--soft" data-action="open-fares"
          aria-label="Ver tasa y tarifas">${icon('ticket')}</button>
      </div>

      <div class="results-context">
        <span>${icon('locate', 'icon icon--tiny')} ${escapeHtml(originLabel)}</span>
        <span class="results-context__sep"></span>
        <span>${icon('route', 'icon icon--tiny')} ${lineCount} ${lineCount === 1 ? 'línea directa' : 'líneas directas'}</span>
      </div>

      ${offline ? `<p class="inline-note">Estás sin conexión. Usamos la red y la tasa guardadas en el dispositivo.</p>` : ''}
      ${origin?.source === 'demo' ? `<p class="inline-note inline-note--warning">${icon('info', 'icon icon--tiny')} Recorrido calculado desde una ubicación de muestra. <button type="button" class="inline-link" data-action="refresh-location">Usar mi GPS</button></p>` : ''}

      <div class="section-heading section-heading--routes">
        <h3>Opciones directas</h3>
        <span>${candidates.length > 1 ? 'Toca para ver en el mapa' : 'Sentido ya validado'}</span>
      </div>

      <div class="trip-list" role="list">
        ${candidates.map((candidate, index) => `
          <div role="listitem">${tripCard(candidate, index, selectedId ?? selected.id, rateInfo)}</div>
        `).join('')}
      </div>

      <div class="results-foot">
        ${rateFooterButton(rateInfo)}
        <p class="micro-credit">Tiempos estimados con datos abiertos. Sin seguimiento en vivo. Pasaje normal de ${formatUsd(APP_CONFIG.fares.normalUsd)} calculado con la tasa BCV.</p>
      </div>
    </section>`, { view: 'results', preserveScroll });
  }

  function renderEmpty({
    destination,
    origin,
    result = {},
    places = [],
    network = null,
    rateInfo = null,
    offline = false,
  }) {
    const isClose = result.reason === 'walk-only';
    const lineCount = network?.groups?.length ?? 0;
    const networkEmpty = lineCount === 0 || result.reason === 'no-network';
    const title = isClose
      ? 'Estás a un paseo'
      : networkEmpty
        ? 'La red está lista para digitalizarse'
        : 'No hay ruta directa';
    const distance = Number(result.straightDistanceM);
    const walkMinutes = Number(result.walkOnlyMinutes);
    const copy = isClose
      ? `Tu destino está a ${formatDistance(distance)}. Caminando son unos ${minuteLabel(walkMinutes)}; no hace falta tomar una línea.`
      : networkEmpty
        ? `Todavía no hay líneas de ${APP_CONFIG.city.name} cargadas. Añade recorridos validados en data/rutas.json y aparecerán aquí automáticamente.`
        : `Ninguna de las ${lineCount} líneas de esta red pasa cerca de tu origen y tu destino en el sentido correcto. Prueba otro destino o explora la red mientras sumamos más líneas.`;

    setSheet(`<section class="empty-view">
      <div class="view-top">
        <button type="button" class="icon-button icon-button--soft" data-action="reset-search"
          aria-label="Cambiar destino">${icon('arrow-left')}</button>
        <div class="view-top__text">
          <p class="eyebrow eyebrow--plain">Rutas hacia</p>
          <h2>${escapeHtml(destination?.name ?? 'Tu destino')}</h2>
        </div>
      </div>

      <div class="empty-icon">${isClose ? icon('walk') : icon('route')}</div>
      <h2 class="empty-title">${title}</h2>
      <p class="empty-copy">${escapeHtml(copy)}</p>
      ${offline ? `<p class="inline-note">Sin conexión: esta búsqueda se calculó con la red guardada.</p>` : ''}

      ${Number.isFinite(distance) && distance > 0 ? `<div class="empty-fact">
        ${icon('pin', 'icon icon--small')}
        <span><small>Distancia aproximada</small><strong>${formatDistance(distance)}</strong></span>
      </div>` : ''}

      <div class="empty-actions ${networkEmpty ? 'empty-actions--single' : ''}">
        ${networkEmpty
          ? `<button type="button" class="button button--primary button--full" data-action="home">
              ${icon('map', 'icon icon--small')} Volver al inicio
            </button>`
          : `<button type="button" class="button button--primary" data-action="focus-search">
              ${icon('search', 'icon icon--small')} Cambiar destino
            </button>
            <button type="button" class="button button--secondary" data-action="open-lines">
              ${icon('layers', 'icon icon--small')} Explorar líneas
            </button>`}
      </div>

      ${networkEmpty ? '' : quickPlacesInEmpty(places)}

      <div class="results-foot">
        ${rateFooterButton(rateInfo)}
        <p class="micro-credit">${networkEmpty
          ? 'La red se activará automáticamente cuando existan líneas digitalizadas.'
          : 'La red crece con validación comunitaria. Aún no hay transbordos.'}</p>
      </div>
    </section>`, { view: 'empty' });
  }

  /* ------------------------------------------------------------------ */
  /* Búsqueda                                                            */
  /* ------------------------------------------------------------------ */

  function setSearchValue(value) {
    if (!el.searchInput) return;
    el.searchInput.value = value ?? '';
    if (el.clearSearch) el.clearSearch.hidden = !el.searchInput.value;
  }

  function setSearchExpanded(expanded) {
    el.searchInput?.setAttribute('aria-expanded', String(Boolean(expanded)));
    el.searchForm?.classList.toggle('is-open', Boolean(expanded));
  }

  function showSuggestions({ title = 'Resultados', items = [], status = 'results', message = '' } = {}) {
    if (!el.suggestions) return;
    let content = '';

    if (status === 'loading') {
      content = `<div class="suggestion-loading" role="status" aria-label="Buscando destinos">
        ${[1, 2, 3].map(() => `<div class="suggestion-skeleton">
          <span class="skeleton skeleton--avatar"></span>
          <span class="suggestion-skeleton__text"><span class="skeleton skeleton--line"></span><span class="skeleton skeleton--short"></span></span>
        </div>`).join('')}
      </div>`;
    } else if (status === 'error') {
      content = `<div class="suggestions-message suggestions-message--error">
        ${icon('info', 'icon icon--small')}
        <p>${escapeHtml(message || 'No pudimos buscar ahora.')}</p>
      </div>`;
    } else if (status === 'empty') {
      content = `<div class="suggestions-message">
        ${icon('map', 'icon icon--small')}
        <p>${escapeHtml(message || 'No encontramos ese lugar. Prueba con otro nombre o elige el punto en el mapa.')}</p>
      </div>`;
    } else if (items.length) {
      content = `<div class="suggestion-list" role="listbox" aria-label="Sugerencias de destino">
        ${items.map((item, index) => `
          <button type="button" class="suggestion" role="option" data-action="choose-suggestion"
            data-suggestion-index="${index}">
            <span class="suggestion__icon">${icon(item.source === 'recent' ? 'clock' : 'pin')}</span>
            <span class="suggestion__text">
              <strong>${escapeHtml(item.name)}</strong>
              <small>${escapeHtml(item.context || item.displayName || APP_CONFIG.city.name)}</small>
            </span>
            ${icon('chevron-right', 'icon icon--tiny suggestion__chevron')}
          </button>
        `).join('')}
      </div>`;
    } else {
      content = `<div class="suggestions-message"><p>Escribe al menos 3 letras para buscar.</p></div>`;
    }

    el.suggestions.innerHTML = `<div class="suggestions-inner">
      <div class="suggestions-head">
        <span>${escapeHtml(title)}</span>
      </div>
      ${content}
      <div class="suggestions-foot">
        <button type="button" class="suggestions-map-button" data-action="pick-on-map">
          ${icon('map', 'icon icon--small')} Elegir en el mapa
        </button>
      </div>
    </div>`;
    el.suggestions.hidden = false;
    setSearchExpanded(true);
  }

  function hideSuggestions() {
    if (!el.suggestions) return;
    el.suggestions.hidden = true;
    el.suggestions.innerHTML = '';
    setSearchExpanded(false);
  }

  function focusSearch({ select = false } = {}) {
    if (!el.searchInput) return;
    el.searchInput.focus({ preventScroll: true });
    if (select) el.searchInput.select();
  }

  function setSearchBusy(busy) {
    el.searchForm?.classList.toggle('is-busy', Boolean(busy));
  }

  function setLocating(locating) {
    el.locateButton?.classList.toggle('is-locating', Boolean(locating));
    el.locateButton?.setAttribute('aria-busy', String(Boolean(locating)));
  }

  /* ------------------------------------------------------------------ */
  /* Diálogos                                                           */
  /* ------------------------------------------------------------------ */

  function openDialog({ kicker = '', title = '', body = '', className = '' }) {
    if (!el.dialogRoot) return;
    if (el.dialogRoot.hidden) previousFocus = document.activeElement;
    el.dialogKicker.textContent = kicker;
    el.dialogKicker.hidden = !kicker;
    el.dialogTitle.textContent = title;
    el.dialogBody.innerHTML = body;
    el.dialogPanel.className = `dialog ${className}`.trim();
    el.dialogRoot.hidden = false;
    document.body.classList.add('is-dialog-open');
    window.requestAnimationFrame(() => {
      el.dialogPanel.focus({ preventScroll: true });
      el.dialogBody.scrollTop = 0;
      notifyLayoutChange();
    });
  }

  function closeDialog() {
    if (!el.dialogRoot || el.dialogRoot.hidden) return;
    el.dialogRoot.hidden = true;
    document.body.classList.remove('is-dialog-open');
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
    previousFocus = null;
    notifyLayoutChange();
  }

  function isDialogOpen() {
    return Boolean(el.dialogRoot && !el.dialogRoot.hidden);
  }

  function menuBody({ theme, network, standalone }) {
    const dark = theme === 'dark';
    return `<div class="action-list">
      <button type="button" class="action-row" id="theme-row" data-action="toggle-theme"
        aria-pressed="${dark}">
        <span class="action-row__icon">${icon(dark ? 'sun' : 'moon')}</span>
        <span class="action-row__text">
          <strong>${dark ? 'Modo claro' : 'Modo oscuro'}</strong>
        </span>
        <span class="switch ${dark ? 'is-on' : ''}" aria-hidden="true"><span></span></span>
      </button>

      <button type="button" class="action-row" data-action="open-fares">
        <span class="action-row__icon">${icon('ticket')}</span>
        <span class="action-row__text">
          <strong>Calculadora de pasajes</strong>
        </span>
        ${icon('chevron-right', 'icon icon--small')}
      </button>

      <button type="button" class="action-row" data-action="open-lines">
        <span class="action-row__icon">${icon('layers')}</span>
        <span class="action-row__text">
          <strong>Líneas de la ciudad</strong>
        </span>
        ${icon('chevron-right', 'icon icon--small')}
      </button>

      <button type="button" class="action-row" data-action="open-about">
        <span class="action-row__icon">${icon('shield')}</span>
        <span class="action-row__text">
          <strong>Cómo funciona y privacidad</strong>
        </span>
        ${icon('chevron-right', 'icon icon--small')}
      </button>

      ${standalone ? '' : `<button type="button" class="action-row" data-action="install-app">
        <span class="action-row__icon">${icon('download')}</span>
        <span class="action-row__text">
          <strong>Instalar Rapidito</strong>
        </span>
        ${icon('chevron-right', 'icon icon--small')}
      </button>`}
    </div>

    <footer class="dialog-credit">
      <span>Rapidito v${escapeHtml(network?.appVersion ?? APP_CONFIG.version)}</span>
    </footer>`;
  }

  function openMenu(options) {
    openDialog({
      title: 'Menú',
      className: 'dialog--menu',
      body: menuBody(options),
    });
  }

  function lineRows(network, rateInfo) {
    const groups = network?.groups ?? [];
    if (!groups.length) {
      return `<div class="suggestions-message"><p>La red aún no tiene líneas cargadas. Añade recorridos validados en <strong>data/rutas.json</strong>.</p></div>`;
    }

    const normalUsd = APP_CONFIG.fares.normalUsd;
    const normalBs = normalFareInBolivares(rateInfo?.rate);

    return `<div class="line-list">${groups.map((group) => `
      <button type="button" class="line-row" data-action="show-line" data-group-id="${escapeHtml(group.id)}">
        ${linePill(group.id, group.color)}
        <span class="line-row__main">
          <strong>${escapeHtml(group.name)}</strong>
          <small>${escapeHtml(group.endpointsLabel)}</small>
          <span class="line-row__meta">${formatUsd(normalUsd)}${normalBs === null ? '' : ` · ${formatBolivares(normalBs)}`} · cada ${minuteLabel(group.frequencyMin)}</span>
        </span>
        ${icon('chevron-right', 'icon icon--small')}
      </button>`
    ).join('')}</div>`;
  }

  function openLines({ network, rateInfo }) {
    const groups = network?.groups ?? [];
    openDialog({
      kicker: 'Explora sin buscar',
      title: 'Líneas de la ciudad',
      className: 'dialog--lines',
      body: `<p class="dialog-lede">Toca una línea para verla completa en el mapa. Las líneas tienen un solo sentido por recorrido; la app no te sugiere el sentido contrario.</p>
        ${lineRows(network, rateInfo)}
        <div class="dialog-callout">
          ${icon('info', 'icon icon--small')}
          <p>${escapeHtml(network?.meta?.disclaimer ?? 'Datos locales. Valida cada línea antes de viajar.')}</p>
        </div>
        <footer class="dialog-credit">
          <span>${groups.length} líneas · ${network?.routes?.length ?? 0} recorridos</span>
        </footer>`,
    });
  }

  function fareRows(network, rateInfo) {
    const groups = network?.groups ?? [];
    const normalUsd = APP_CONFIG.fares.normalUsd;
    const normalBs = normalFareInBolivares(rateInfo?.rate);
    return groups.map((group) => `
      <div class="fare-row">
        ${linePill(group.id, group.color)}
        <span class="fare-row__name">${escapeHtml(group.name)}</span>
        <span class="fare-row__usd">${formatUsd(normalUsd)}</span>
        <strong class="fare-row__bs">${normalBs === null ? 'Bs. —' : formatBolivares(normalBs)}</strong>
      </div>`
    ).join('');
  }

  function updateFareCalculator() {
    if (!el.dialogBody) return;
    const normal = clampFareQuantity(fareQuantities.normal);
    const student = clampFareQuantity(fareQuantities.student);

    for (const [type, value] of [['normal', normal], ['student', student]]) {
      const valueEl = el.dialogBody.querySelector(`[data-fare-quantity="${type}"]`);
      if (valueEl) valueEl.textContent = String(value);
    }

    el.dialogBody.querySelectorAll('[data-action="change-fare-quantity"]').forEach((button) => {
      const type = button.dataset.fareType;
      const value = type === 'student' ? student : normal;
      button.disabled = Number(button.dataset.delta) < 0
        ? value <= 0
        : value >= MAX_FARE_QUANTITY;
    });

    const total = fareTotalInBolivares(normal, student, fareRateInfo?.rate);
    const totalEl = el.dialogBody.querySelector('[data-fare-total]');
    if (totalEl) totalEl.textContent = total === null ? 'Bs. —' : formatBolivares(total);

    const detailEl = el.dialogBody.querySelector('[data-fare-total-detail]');
    if (detailEl) detailEl.textContent = fareQuantityDetail(normal, student);
  }

  function changeFareQuantity(type, delta) {
    if (type !== 'normal' && type !== 'student') return;
    const step = Number(delta);
    if (!Number.isFinite(step) || step === 0) return;

    const current = clampFareQuantity(fareQuantities[type]);
    const next = clampFareQuantity(current + step);
    if (next === current) return;

    fareQuantities[type] = next;
    updateFareCalculator();
  }

  function openFares({ network, rateInfo, loading = false }) {
    const available = rateInfo && Number.isFinite(Number(rateInfo.rate));
    const updated = rateInfo?.apiUpdatedAt || rateInfo?.fetchedAt;
    const groups = network?.groups ?? [];
    const normalUsd = APP_CONFIG.fares.normalUsd;
    const studentUsd = APP_CONFIG.fares.studentUsd;
    const normalBs = normalFareInBolivares(rateInfo?.rate);
    const studentBs = studentFareInBolivares(rateInfo?.rate);
    const normalQty = clampFareQuantity(fareQuantities.normal);
    const studentQty = clampFareQuantity(fareQuantities.student);
    const total = fareTotalInBolivares(normalQty, studentQty, rateInfo?.rate);
    fareRateInfo = rateInfo;

    openDialog({
      kicker: 'Tasa oficial BCV',
      title: 'Calculadora de pasajes',
      className: 'dialog--fares',
      body: `<div class="rate-hero ${available ? '' : 'rate-hero--empty'}">
        <span class="rate-hero__label">${icon('ticket', 'icon icon--small')} Dólar oficial</span>
        ${available
          ? `<strong class="rate-hero__value">Bs. ${formatRate(rateInfo.rate)}</strong>
             <span class="rate-hero__unit">por 1 USD · ${rateInfo.stale ? 'tasa guardada' : 'tasa de referencia'}</span>
             <span class="rate-hero__date">${icon('clock', 'icon icon--tiny')} ${updated ? formatRateDate(updated) : 'sin fecha'}</span>`
          : `<strong class="rate-hero__value">Bs. —</strong>
             <span class="rate-hero__unit">No pudimos leer la tasa en este momento.</span>
             <span class="rate-hero__date">Revisa tu conexión e inténtalo de nuevo. La tarifa en USD sigue disponible.</span>`}
      </div>

      <div class="fare-calculator" role="group" aria-label="Calculadora de pasajes">
        <div class="fare-calculator__list">
          ${fareQuantityRowMarkup('normal', 'Pasajes normales', normalUsd, normalBs, normalQty)}
          ${fareQuantityRowMarkup('student', 'Pasajes estudiantiles', studentUsd, studentBs, studentQty)}
        </div>
        <div class="fare-total" role="status" aria-live="polite">
          <span class="fare-total__label">${icon('ticket', 'icon icon--tiny')} Total a pagar</span>
          <strong class="fare-total__amount" data-fare-total>${total === null ? 'Bs. —' : formatBolivares(total)}</strong>
          <span class="fare-total__detail" data-fare-total-detail>${escapeHtml(fareQuantityDetail(normalQty, studentQty))}</span>
        </div>
      </div>

      ${groups.length ? `<div class="fare-board" aria-label="Tarifas por línea">
        <div class="fare-board__head"><span>Línea</span><span>USD</span><span>Bolívares</span></div>
        ${fareRows(network, rateInfo)}
      </div>` : ''}

      <button type="button" class="button button--secondary button--full" data-action="refresh-rate" data-rate-refresh ${loading ? 'disabled' : ''}>
        ${icon('refresh', 'icon icon--small')} ${loading ? 'Actualizando…' : 'Actualizar tasa'}
      </button>`,
    });
  }

  function openAbout({ network, standalone }) {
    openDialog({
      kicker: 'Transparencia',
      title: 'Cómo funciona',
      className: 'dialog--about',
      body: `<div class="about-intro">
        <span class="about-mark">${logoMark()}</span>
        <p>Rapidito convierte información dispersa del transporte en una respuesta clara: qué línea tomar, dónde subir y cuánto pagar.</p>
      </div>

      <div class="about-steps">
        <div class="about-step">
          <span>01</span>
          <div><strong>Cruce espacial</strong><p>Tu GPS y el destino se proyectan sobre cada trazado. Buscamos paradas de subida y bajada que estén a una caminata razonable.</p></div>
        </div>
        <div class="about-step">
          <span>02</span>
          <div><strong>Sentido verificado</strong><p>Comparamos la posición acumulada de las paradas sobre la ruta. Si la bajada no está delante de la subida, esa línea no se recomienda.</p></div>
        </div>
        <div class="about-step">
          <span>03</span>
          <div><strong>Pasaje al día</strong><p>El pasaje normal de ${formatUsd(APP_CONFIG.fares.normalUsd)} se convierte a bolívares con la tasa oficial BCV que publica DolarAPI.</p></div>
        </div>
      </div>

      <div class="about-section">
        <h3>Datos abiertos, no cajas negras</h3>
        <p>Las líneas viven en un GeoJSON externo. Geocodificación: <a href="https://nominatim.org/" target="_blank" rel="noopener noreferrer">Nominatim</a>. Tasa: <a href="https://ve.dolarapi.com/" target="_blank" rel="noopener noreferrer">DolarAPI</a>.</p>
      </div>

      <div class="about-section">
        <h3>Privacidad</h3>
        <p>Tu ubicación se procesa en el dispositivo y no se guarda en un servidor de Rapidito. Para buscar destinos enviamos el texto a Nominatim. No hay cuentas ni rastreadores publicitarios.</p>
        <p>Los destinos recientes y la tasa quedan en el almacenamiento local de este navegador. Puedes borrarlos eliminando los datos del sitio.</p>
      </div>

      <div class="about-section">
        <h3>Estado de los datos</h3>
        <p>${escapeHtml(network?.meta?.disclaimer ?? 'La red está pendiente de digitalización.')}</p>
        <p>Actualización del archivo: ${network?.meta?.updatedAt ? formatShortDate(network.meta.updatedAt) : 'sin fecha'}. ${standalone ? 'App instalada.' : 'Modo navegador.'}</p>
      </div>

      <footer class="dialog-credit">
        <span>Rapidito PWA · v${escapeHtml(network?.appVersion ?? APP_CONFIG.version)}</span>
      </footer>`,
    });
  }

  function openInstallHelp({ isIos = false, standalone = false } = {}) {
    openDialog({
      kicker: 'Llévalo contigo',
      title: 'Instalar Rapidito',
      className: 'dialog--install',
      body: `<div class="install-illustration">
        <span class="install-illustration__mark">${logoMark()}</span>
        <span class="install-illustration__plus">+</span>
        <span class="install-illustration__screen">${icon('download')}</span>
      </div>
      ${standalone
        ? `<p class="dialog-lede">Ya estás usando Rapidito como app instalada. La red, la última tasa y los mapas visitados pueden funcionar sin conexión.</p>`
        : `<p class="dialog-lede">Añade Rapidito a tu pantalla de inicio para abrirlo sin barra del navegador y con la red disponible sin conexión.</p>
          <ol class="install-steps">
            ${isIos
              ? `<li><span>1</span> Toca el botón Compartir de Safari.</li>
                  <li><span>2</span> Elige “Añadir a pantalla de inicio”.</li>
                  <li><span>3</span> Confirma con “Añadir”.</li>`
              : `<li><span>1</span> Abre el menú del navegador.</li>
                  <li><span>2</span> Elige “Instalar aplicación” o “Añadir a pantalla de inicio”.</li>
                  <li><span>3</span> Confirma la instalación.</li>`}
          </ol>`}
      <div class="dialog-callout">${icon('shield', 'icon icon--small')}<p>Rapidito no pide cuenta. La geolocalización solo se activa cuando la usas.</p></div>
      <button type="button" class="button button--primary button--full" data-action="close-dialog">Entendido</button>`,
    });
  }

  function setRateLoading(loading) {
    const button = el.dialogBody.querySelector('[data-rate-refresh]');
    if (!button) return;
    button.disabled = Boolean(loading);
    button.innerHTML = `${icon('refresh', 'icon icon--small')} ${loading ? 'Actualizando…' : 'Actualizar tasa'}`;
  }

  /* ------------------------------------------------------------------ */
  /* Tema y controles                                                    */
  /* ------------------------------------------------------------------ */

  function setTheme(theme) {
    if (el.themeMeta) {
      el.themeMeta.setAttribute('content', theme === 'dark' ? '#07142E' : '#305CDE');
    }

    const themeRow = document.getElementById('theme-row');
    if (themeRow) {
      const dark = theme === 'dark';
      themeRow.setAttribute('aria-pressed', String(dark));
      const label = themeRow.querySelector('.action-row__text strong');
      if (label) label.textContent = dark ? 'Modo claro' : 'Modo oscuro';
      const iconSlot = themeRow.querySelector('.action-row__icon');
      if (iconSlot) iconSlot.innerHTML = icon(dark ? 'sun' : 'moon');
      const switchEl = themeRow.querySelector('.switch');
      switchEl?.classList.toggle('is-on', dark);
    }
  }

  function setClearButtonVisible(visible) {
    if (el.clearSearch) el.clearSearch.hidden = !visible;
  }

  /* ------------------------------------------------------------------ */
  /* Eventos propios de la capa                                         */
  /* ------------------------------------------------------------------ */

  el.dialogClose?.addEventListener('click', closeDialog);
  el.dialogRoot?.addEventListener('click', (event) => {
    if (event.target === el.dialogRoot) closeDialog();
  });
  el.dialogRoot?.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusables = [...el.dialogPanel.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]',
    )].filter((node) => node.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isDialogOpen()) {
      event.preventDefault();
      closeDialog();
    }
  });

  // Mantiene el CSS informado del alto real del sheet para posicionar los
  // créditos del mapa y evitar que queden debajo del panel.
  if (typeof ResizeObserver === 'function' && el.sheet) {
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        '--sheet-height',
        `${Math.round(el.sheet.getBoundingClientRect().height)}px`,
      );
      notifyLayoutChange();
    });
    observer.observe(el.sheet);
  }

  return {
    el,
    setBootStatus,
    hideBoot,
    renderLoadingView,
    renderErrorView,
    renderIdle,
    renderResults,
    renderEmpty,
    setSearchValue,
    setSearchExpanded,
    showSuggestions,
    hideSuggestions,
    focusSearch,
    setSearchBusy,
    setLocating,
    setClearButtonVisible,
    openDialog,
    closeDialog,
    isDialogOpen,
    openMenu,
    openLines,
    openFares,
    changeFareQuantity,
    openAbout,
    openInstallHelp,
    setRateLoading,
    setTheme,
    formatDistance,
  };
}
