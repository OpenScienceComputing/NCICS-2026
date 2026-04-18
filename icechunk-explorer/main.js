import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ZarrLayer } from '@carbonplan/zarr-layer'
import * as zarr from 'zarrita'
import { Repository } from '@earthmover/icechunk'
import { createFetchStorage } from '@earthmover/icechunk/fetch-storage'
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
    clim: p.get('clim') ? p.get('clim').split(',').map(Number) : [0, 1],
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
// Open store — tries Icechunk v2, then v1, then falls back to plain Zarr
// ---------------------------------------------------------------------------
async function openStore(url, snap) {
  // Try @earthmover/icechunk (v2)
  try {
    const storage = createFetchStorage(url)
    const repo = await Repository.open(storage)
    const sessionOpts = snap ? { snapshotId: snap } : { branch: 'main' }
    const session = await repo.readonlySession(sessionOpts)
    console.info('Opened as Icechunk v2')
    return { store: session.store, isIcechunk: true, storeType: 'Icechunk v2' }
  } catch (err) {
    console.warn('Icechunk v2 open failed:', err?.message ?? err)
    setStatus(`v2 failed: ${err?.message ?? err} — trying v1…`)
  }

  // Fall back to @carbonplan/icechunk-js (v1)
  try {
    const opts = snap
      ? { snapshotId: snap, formatVersion: 'v1', cache: 'no-store' }
      : { branch: 'main',  formatVersion: 'v1', cache: 'no-store' }
    const store = await IcechunkStore.open(url, opts)
    console.info('Opened as Icechunk v1')
    return { store, isIcechunk: true, storeType: 'Icechunk v1' }
  } catch (err) {
    console.warn('Icechunk v1 open failed:', err?.message ?? err)
    setStatus(`v1 failed: ${err?.message ?? err} — trying plain Zarr…`)
  }

  return { store: null, isIcechunk: false, storeType: 'Zarr (HTTP)' }
}

// ---------------------------------------------------------------------------
// Read zarr metadata to discover variables and dimension sizes
// Uses zarrita the same way zarr-layer does internally.
// ---------------------------------------------------------------------------

const COORD_NAMES = new Set([
  'latitude', 'longitude', 'lat', 'lon', 'x', 'y',
  'time', 'spatial_ref', 'crs', 'proj', 'level',
])

async function readZarrMeta(url, store) {
  let vars = []
  let timeDimSize = 1
  let shape = null
  let dtype = null
  let dims = null

  // ── Path 1: use zarrita (same pattern as zarr-layer) ────────────────
  if (store) {
    try {
      const root = await zarr.open(zarr.root(store), { kind: 'group' })
      const attrs = root.attrs || {}
      const multiscales = attrs.multiscales

      // Parse level paths — handle OME-NGFF array and topozarr object formats
      let levelPaths = []
      if (Array.isArray(multiscales) && multiscales.length > 0) {
        levelPaths = (multiscales[0].datasets || []).map(d => d.path).filter(Boolean)
      } else if (multiscales?.layout?.length > 0) {
        levelPaths = multiscales.layout.map(l => l.asset).filter(Boolean)
      }

      if (levelPaths.length > 0) {
        // Multiscale DataTree: variables are arrays inside each level group
        const firstLevel = levelPaths[0]
        const levelGroup = await zarr.open(root.resolve(firstLevel), { kind: 'group' })

        // list() all keys and extract immediate children of the level group
        const prefix = firstLevel + '/'
        const allKeys = await store.list()
        const children = new Set()
        for (const key of allKeys) {
          if (!key.startsWith(prefix)) continue
          const name = key.slice(prefix.length).split('/')[0]
          if (name) children.add(name)
        }
        vars = [...children].filter(n => !COORD_NAMES.has(n))
        console.info('vars discovered:', vars)

        // Get shape/dtype/dims via zarrita
        if (vars.length > 0) {
          const arr = await zarr.open(levelGroup.resolve(vars[0]), { kind: 'array' })
          shape = [...arr.shape]
          dtype = String(arr.dtype)
          // zarr v3: dimension_names is top-level in zarr.json, exposed via arr.meta
          // zarr v2 compat: _ARRAY_DIMENSIONS in attributes
          dims  = arr.meta?.dimension_names
               ?? arr.attrs?._ARRAY_DIMENSIONS
               ?? arr.attrs?.dimension_names
               ?? null
        }
      } else {
        // Flat group: variables are direct children of root
        const allKeys = await store.list()
        const children = new Set()
        for (const key of allKeys) {
          const name = key.split('/')[0]
          if (name && !name.startsWith('zarr') && !name.startsWith('.')) children.add(name)
        }
        vars = [...children].filter(n => !COORD_NAMES.has(n))

        if (vars.length > 0) {
          const arr = await zarr.open(root.resolve(vars[0]), { kind: 'array' })
          shape = [...arr.shape]
          dtype = String(arr.dtype)
          dims  = arr.meta?.dimension_names
               ?? arr.attrs?._ARRAY_DIMENSIONS
               ?? arr.attrs?.dimension_names
               ?? null
        }
      }
    } catch (err) {
      console.warn('zarrita metadata read failed:', err)
    }
  }

  // ── Path 2: HTTP fallback for plain Zarr over HTTP ───────────────────
  const tryFetch = async (path) => {
    try { const r = await fetch(path); return r.ok ? r.json() : null }
    catch { return null }
  }

  if (vars.length === 0) {
    const czm = await tryFetch(`${url}/.zmetadata`)
    if (czm?.metadata) {
      vars = Object.keys(czm.metadata)
        .filter(k => k.endsWith('/.zarray'))
        .map(k => k.replace('/.zarray', ''))
        .filter(k => !k.includes('/') && k !== '' && !COORD_NAMES.has(k))
    }
  }

  if (vars.length === 0) {
    const v3root = await tryFetch(`${url}/zarr.json`)
    if (v3root?.zarr_format === 3) {
      const nodes = v3root.consolidated_metadata?.metadata ?? {}
      vars = Object.keys(nodes)
        .filter(k => nodes[k].node_type === 'array' && !k.includes('/'))
        .filter(n => !COORD_NAMES.has(n))
    }
  }

  // ── Resolve time dimension size ──────────────────────────────────────
  if (dims && shape) {
    const tIdx = dims.findIndex(d => d === 'time' || d === 't')
    if (tIdx >= 0) timeDimSize = shape[tIdx]
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
  map.triggerRepaint()
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
