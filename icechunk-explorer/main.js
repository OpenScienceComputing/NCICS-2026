import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ZarrLayer } from '@carbonplan/zarr-layer'
import { IcechunkStore } from '@carbonplan/icechunk-js'

// ---------------------------------------------------------------------------
// Colormaps
// ---------------------------------------------------------------------------
const COLORMAPS = {
  viridis:  ['#440154','#482878','#3e4989','#31688e','#26828e','#1f9e89','#35b779','#6ece58','#b5de2b','#fde725'],
  plasma:   ['#0d0887','#46039f','#7201a8','#9c179e','#bd3786','#d8576b','#ed7953','#fb9f3a','#fdcf18','#f0f921'],
  ylgn:     ['#ffffe5','#f7fcb9','#d9f0a3','#addd8e','#78c679','#41ab5d','#238443','#006837','#004529'],
  rdylgn:   ['#a50026','#d73027','#f46d43','#fdae61','#fee08b','#ffffbf','#d9ef8b','#a6d96a','#66bd63','#1a9850','#006837'],
  greens:   ['#f7fcf5','#e5f5e0','#c7e9c0','#a1d99b','#74c476','#41ab5d','#238b45','#006d2c','#00441b'],
  blues:    ['#f7fbff','#deebf7','#c6dbef','#9ecae1','#6baed6','#4292c6','#2171b5','#08519c','#08306b'],
  reds:     ['#fff5f0','#fee0d2','#fcbba1','#fc9272','#fb6a4a','#ef3b2c','#cb181d','#a50f15','#67000d'],
  coolwarm: ['#3b4cc0','#6788ee','#9abbff','#c9d8ef','#edd1c2','#f7a789','#e26952','#b40426'],
}

// ---------------------------------------------------------------------------
// Query-param helpers
// ---------------------------------------------------------------------------
function getParams() {
  const p = new URLSearchParams(window.location.search)
  return {
    url:  p.get('url')  || '',
    snap: p.get('snap') || '',
    varName: p.get('var') || '',
    t:    parseInt(p.get('t') || '0', 10),
    clim: p.get('clim') ? p.get('clim').split(',').map(Number) : null,
    cm:   p.get('cm')   || 'viridis',
  }
}

function pushParams(state) {
  const p = new URLSearchParams()
  if (state.url)     p.set('url',  state.url)
  if (state.snap)    p.set('snap', state.snap)
  if (state.varName) p.set('var',  state.varName)
  p.set('t',    String(state.t))
  if (state.clim) p.set('clim', state.clim.join(','))
  p.set('cm',   state.cm)
  const newSearch = '?' + p.toString()
  if (window.location.search !== newSearch)
    history.replaceState(null, '', newSearch)
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const urlInput      = document.getElementById('url-input')
const snapInput     = document.getElementById('snap-input')
const varSelect     = document.getElementById('var-select')
const loadBtn       = document.getElementById('load-btn')
const statusEl      = document.getElementById('status')
const timeSlider    = document.getElementById('time-slider')
const timeLabel     = document.getElementById('time-label')
const colormapSel   = document.getElementById('colormap-select')
const climMin       = document.getElementById('clim-min')
const climMax       = document.getElementById('clim-max')
const opacitySlider = document.getElementById('opacity-slider')
const opacityLabel  = document.getElementById('opacity-label')
const metaPanel     = document.getElementById('meta-panel')
const layerControls = document.getElementById('layer-controls')

function setStatus(msg, cls = '') {
  statusEl.textContent = msg
  statusEl.className = cls
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  center: [0, 20],
  zoom: 1.5,
  projection: 'mercator',
})
map.addControl(new maplibregl.NavigationControl(), 'top-left')
map.on('moveend', () => map.triggerRepaint())
map.on('zoomend', () => map.triggerRepaint())

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
let appState = {
  url: '',
  snap: '',
  varName: '',
  t: 0,
  clim: [0, 1],
  cm: 'viridis',
}
let layer = null
let timeCoords = null  // array of coordinate labels if available

// ---------------------------------------------------------------------------
// Open store — tries IcechunkStore first, falls back to plain Zarr URL
// ---------------------------------------------------------------------------
async function openStore(url, snap) {
  try {
    const opts = snap
      ? { snapshotId: snap, formatVersion: 'v1', cache: 'no-store' }
      : { branch: 'main',  formatVersion: 'v1', cache: 'no-store' }
    const store = await IcechunkStore.open(url, opts)
    return { store, isIcechunk: true }
  } catch {
    // Not an Icechunk store — ZarrLayer accepts a plain URL string
    return { store: null, isIcechunk: false }
  }
}

// ---------------------------------------------------------------------------
// Read zarr metadata to discover variables and dimension sizes
// ---------------------------------------------------------------------------
async function readZarrMeta(url, store) {
  // Try Zarr v3 consolidated metadata first, then v2
  const tryFetch = async (path) => {
    const r = await fetch(path)
    return r.ok ? r.json() : null
  }

  let vars = []
  let timeDimSize = 1
  let shape = null
  let dtype = null
  let dims = null

  // Zarr v3: zarr.json at root lists group contents
  const v3root = await tryFetch(`${url}/zarr.json`)
  if (v3root && v3root.zarr_format === 3) {
    // Read consolidated metadata if present
    const consolidated = await tryFetch(`${url}/zarr.json`) // root is also the group
    // List arrays by trying common top-level names via store listing isn't straightforward
    // Instead walk known patterns: members in the group node_type
    if (v3root.node_type === 'group') {
      // consolidated zarr v3 has no member list in zarr.json itself;
      // try to read chunk manifest / fall back to fetching common names
      // Best effort: check for a .zmetadata or consolidated metadata
    }
    // Try consolidated metadata endpoint
    const czm = await tryFetch(`${url}/.zmetadata`)
    if (czm && czm.metadata) {
      vars = Object.keys(czm.metadata)
        .filter(k => k.endsWith('/.zarray') || k.endsWith('/zarr.json'))
        .map(k => k.replace(/\/(\.zarray|zarr\.json)$/, ''))
        .filter(k => !k.includes('/') && k !== '')
    }
  }

  // Zarr v2: .zmetadata consolidated
  if (vars.length === 0) {
    const czm = await tryFetch(`${url}/.zmetadata`)
    if (czm && czm.metadata) {
      vars = Object.keys(czm.metadata)
        .filter(k => k.endsWith('/.zarray'))
        .map(k => k.replace('/.zarray', ''))
        .filter(k => !k.includes('/') && k !== '')
    }
  }

  // If we found a variable, read its metadata for shape/dtype/dims
  if (vars.length > 0) {
    const firstVar = vars[0]
    const zarray = await tryFetch(`${url}/${firstVar}/.zarray`)
      || await tryFetch(`${url}/${firstVar}/zarr.json`)
    const zattrs = await tryFetch(`${url}/${firstVar}/.zattrs`)
      || await tryFetch(`${url}/${firstVar}/zarr.json`)

    if (zarray) {
      shape = zarray.shape || zarray.shape
      dtype = zarray.dtype || zarray.data_type
    }
    if (zattrs) {
      dims = zattrs._ARRAY_DIMENSIONS || zattrs.dimension_names
    }

    // Try to get time coord labels
    if (dims) {
      const tDimIdx = dims.findIndex(d => d === 'time' || d === 't')
      if (tDimIdx >= 0 && shape) {
        timeDimSize = shape[tDimIdx]
        const timeArr = await tryFetch(`${url}/time/.zarray`)
        if (timeArr) {
          // time coordinate exists — try to read its data chunk
          // For small time arrays, chunk 0 contains all values
          const timeAttrs = await tryFetch(`${url}/time/.zattrs`)
          timeCoords = null // would need zarr decode; leave as indices for now
        }
      }
    }
  }

  return { vars, shape, dtype, dims, timeDimSize }
}

// ---------------------------------------------------------------------------
// Populate variable dropdown
// ---------------------------------------------------------------------------
function populateVarSelect(vars, selected) {
  varSelect.innerHTML = '<option value="">— variable —</option>'
  vars.forEach(v => {
    const opt = document.createElement('option')
    opt.value = v
    opt.textContent = v
    if (v === selected) opt.selected = true
    varSelect.appendChild(opt)
  })
}

// ---------------------------------------------------------------------------
// Update metadata panel
// ---------------------------------------------------------------------------
function updateMeta(url, snap, varName, shape, dtype, dims, isIcechunk) {
  const storeType = isIcechunk ? 'Icechunk' : 'Zarr'
  const snapLine = snap ? `<br>snapshot: ${snap.slice(0, 12)}…` : '(branch: main)'
  metaPanel.innerHTML = `
    <strong>Store (${storeType})</strong>${url}<br>${snapLine}
    <br><br>
    <strong>Variable</strong>${varName}
    ${shape ? `<br>shape: [${shape.join(', ')}]` : ''}
    ${dtype ? `<br>dtype: ${dtype}` : ''}
    ${dims  ? `<br>dims: [${dims.join(', ')}]` : ''}
  `
}

// ---------------------------------------------------------------------------
// Render / update layer
// ---------------------------------------------------------------------------
async function renderLayer(url, store, varName, state) {
  // Remove existing layer
  if (layer) {
    try { map.removeLayer('explorer') } catch {}
    layer = null
  }

  layer = new ZarrLayer({
    id: 'explorer',
    source: url,
    ...(store ? { store } : {}),
    variable: varName,
    clim: state.clim,
    colormap: COLORMAPS[state.cm],
    opacity: state.opacity ?? 0.85,
    zarrVersion: 3,
    selector: { time: { selected: state.t, type: 'index' } },
    bounds: [-180, -90, 180, 90],
  })

  map.addLayer(layer)
  setStatus('rendering…')
  map.once('idle', () => setStatus('ready', 'ready'))
}

// ---------------------------------------------------------------------------
// Main load flow
// ---------------------------------------------------------------------------
let currentStore = null
let currentUrl = ''
let currentSnap = ''
let currentVars = []
let currentMeta = {}

async function loadStore(url, snap) {
  setStatus('opening store…')
  loadBtn.disabled = true

  try {
    const { store, isIcechunk } = await openStore(url, snap)
    currentStore = store
    currentUrl = url
    currentSnap = snap

    setStatus('reading metadata…')
    const meta = await readZarrMeta(url, store)
    currentVars = meta.vars
    currentMeta = { ...meta, isIcechunk }

    if (meta.vars.length === 0) {
      setStatus('no variables found', 'error')
      loadBtn.disabled = false
      return
    }

    populateVarSelect(meta.vars, appState.varName)

    // Update time slider range
    timeSlider.max = String(Math.max(0, meta.timeDimSize - 1))
    if (appState.t >= meta.timeDimSize) appState.t = 0
    timeSlider.value = String(appState.t)
    timeLabel.textContent = String(appState.t)

    // If var already selected (from URL param or prior state), render immediately
    const varToLoad = appState.varName && meta.vars.includes(appState.varName)
      ? appState.varName
      : (meta.vars.length === 1 ? meta.vars[0] : '')

    if (varToLoad) {
      varSelect.value = varToLoad
      appState.varName = varToLoad
      await loadVariable(varToLoad)
    } else {
      setStatus('select a variable', '')
      // Show sidebar controls so colormap/clim are accessible
      layerControls.style.display = 'block'
      updateMeta(url, snap, '(none selected)', meta.shape, meta.dtype, meta.dims, isIcechunk)
    }
  } catch (err) {
    setStatus('error — check URL and CORS', 'error')
    console.error(err)
  }

  loadBtn.disabled = false
}

async function loadVariable(varName) {
  if (!currentUrl) return
  appState.varName = varName
  pushParams(appState)

  setStatus('loading…')
  layerControls.style.display = 'block'

  updateMeta(
    currentUrl, currentSnap, varName,
    currentMeta.shape, currentMeta.dtype, currentMeta.dims,
    currentMeta.isIcechunk
  )

  await renderLayer(currentUrl, currentStore, varName, {
    clim: appState.clim,
    cm: appState.cm,
    t: appState.t,
    opacity: parseFloat(opacitySlider.value),
  })
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
function debounce(fn, ms) {
  let timer
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms) }
}

loadBtn.addEventListener('click', () => {
  const url  = urlInput.value.trim()
  const snap = snapInput.value.trim()
  if (!url) { setStatus('enter a URL', 'error'); return }
  appState.url  = url
  appState.snap = snap
  pushParams(appState)
  loadStore(url, snap)
})

varSelect.addEventListener('change', () => {
  const v = varSelect.value
  if (v) loadVariable(v)
})

timeSlider.addEventListener('input', debounce(() => {
  appState.t = Number(timeSlider.value)
  timeLabel.textContent = String(appState.t)
  layer?.setSelector({ time: { selected: appState.t, type: 'index' } })
  pushParams(appState)
}, 150))

colormapSel.addEventListener('change', () => {
  appState.cm = colormapSel.value
  layer?.setColormap(COLORMAPS[appState.cm])
  pushParams(appState)
})

function updateClim() {
  appState.clim = [Number(climMin.value), Number(climMax.value)]
  layer?.setClim(appState.clim)
  pushParams(appState)
}
climMin.addEventListener('change', updateClim)
climMax.addEventListener('change', updateClim)

opacitySlider.addEventListener('input', () => {
  const v = Number(opacitySlider.value)
  opacityLabel.textContent = v.toFixed(2)
  layer?.setOpacity(v)
})

// ---------------------------------------------------------------------------
// Boot — apply URL params on load
// ---------------------------------------------------------------------------
map.on('load', () => {
  const params = getParams()
  appState = { ...appState, ...params }

  // Restore UI from params
  urlInput.value  = params.url
  snapInput.value = params.snap
  if (params.cm && COLORMAPS[params.cm]) colormapSel.value = params.cm
  if (params.clim) {
    climMin.value = String(params.clim[0])
    climMax.value = String(params.clim[1])
    appState.clim = params.clim
  }
  opacitySlider.value = '0.85'
  opacityLabel.textContent = '0.85'

  if (params.url) loadStore(params.url, params.snap)
})
