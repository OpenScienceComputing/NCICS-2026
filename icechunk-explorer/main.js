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
  const parts = []
  // Keep url unencoded so it stays human-readable in the address bar
  if (state.url)     parts.push(`url=${state.url}`)
  if (state.snap)    parts.push(`snap=${encodeURIComponent(state.snap)}`)
  if (state.varName) parts.push(`var=${encodeURIComponent(state.varName)}`)
  parts.push(`t=${state.t}`)
  if (state.clim)    parts.push(`clim=${state.clim.join(',')}`)
  parts.push(`cm=${encodeURIComponent(state.cm)}`)
  const newSearch = '?' + parts.join('&')
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

// Build a proj4 string from a CF grid_mapping variable's attributes.
// Returns null for latitude_longitude or unsupported projections.
function cfToProjString(a) {
  const name = a.grid_mapping_name
  if (!name || name === 'latitude_longitude') return null

  const fe = a.false_easting  ?? 0
  const fn = a.false_northing ?? 0

  let earth = ''
  if (a.earth_radius != null)      earth = ` +R=${a.earth_radius}`
  else if (a.semi_major_axis != null) {
    earth = ` +a=${a.semi_major_axis}`
    if (a.semi_minor_axis != null)      earth += ` +b=${a.semi_minor_axis}`
    else if (a.inverse_flattening != null) earth += ` +rf=${a.inverse_flattening}`
  }

  const sp = a.standard_parallel
  const lat1 = Array.isArray(sp) ? sp[0] : sp
  const lat2 = Array.isArray(sp) ? (sp[1] ?? sp[0]) : sp

  if (name === 'lambert_conformal_conic') {
    const lon0 = a.longitude_of_central_meridian ?? 0
    const lat0 = a.latitude_of_projection_origin ?? 0
    return `+proj=lcc +lat_1=${lat1} +lat_2=${lat2} +lat_0=${lat0} +lon_0=${lon0} +x_0=${fe} +y_0=${fn}${earth} +units=m +no_defs`
  }
  if (name === 'polar_stereographic') {
    const lon0 = a.straight_vertical_longitude_from_pole ?? a.longitude_of_projection_origin ?? 0
    const lat0 = a.latitude_of_projection_origin ?? 90
    const k    = a.scale_factor_at_projection_origin ?? 1
    return `+proj=stere +lat_0=${lat0} +lon_0=${lon0} +k=${k} +x_0=${fe} +y_0=${fn}${earth} +units=m +no_defs`
  }
  if (name === 'mercator') {
    const lon0 = a.longitude_of_projection_origin ?? 0
    const k    = a.scale_factor_at_projection_origin ?? 1
    return `+proj=merc +lon_0=${lon0} +k=${k} +x_0=${fe} +y_0=${fn}${earth} +units=m +no_defs`
  }
  if (name === 'transverse_mercator') {
    const lon0 = a.longitude_of_central_meridian ?? 0
    const lat0 = a.latitude_of_projection_origin ?? 0
    const k    = a.scale_factor_at_central_meridian ?? 1
    return `+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} +k=${k} +x_0=${fe} +y_0=${fn}${earth} +units=m +no_defs`
  }
  if (name === 'albers_conical_equal_area') {
    const lon0 = a.longitude_of_central_meridian ?? 0
    const lat0 = a.latitude_of_projection_origin ?? 0
    return `+proj=aea +lat_1=${lat1} +lat_2=${lat2} +lat_0=${lat0} +lon_0=${lon0} +x_0=${fe} +y_0=${fn}${earth} +units=m +no_defs`
  }
  if (name === 'lambert_azimuthal_equal_area') {
    const lon0 = a.longitude_of_projection_origin ?? 0
    const lat0 = a.latitude_of_projection_origin ?? 0
    return `+proj=laea +lat_0=${lat0} +lon_0=${lon0} +x_0=${fe} +y_0=${fn}${earth} +units=m +no_defs`
  }
  if (name === 'sinusoidal') {
    const lon0 = a.longitude_of_central_meridian ?? 0
    return `+proj=sinu +lon_0=${lon0} +x_0=${fe} +y_0=${fn}${earth} +units=m +no_defs`
  }
  console.warn('[explorer] unsupported grid_mapping_name:', name)
  return null
}

// Try to find a grid_mapping variable when the data variable lacks a 'grid_mapping' attr.
// Checks variables listed in the 'coordinates' attr first, then probes common CRS names.
async function detectGridMappingVar(rootLoc, coordPrefix, arrAttrs, store) {
  // 1. Parse 'coordinates' attribute (e.g. "latitude longitude spatial_ref")
  if (arrAttrs?.coordinates) {
    const coordVarNames = String(arrAttrs.coordinates).trim().split(/\s+/)
    for (const cv of coordVarNames) {
      if (COORD_NAMES.has(cv)) continue
      try {
        const cvArr = await zarr.open(rootLoc.resolve(coordPrefix + cv), { kind: 'array' })
        if (cvArr.attrs?.grid_mapping_name) {
          console.info('[explorer] found grid_mapping via coordinates attr:', cv)
          return cv
        }
      } catch {}
    }
  }
  // 2. Probe common CRS variable names
  for (const candidate of ['spatial_ref', 'crs', 'lambert_conformal_conic', 'grid_mapping', 'projection']) {
    try {
      const cvArr = await zarr.open(rootLoc.resolve(coordPrefix + candidate), { kind: 'array' })
      if (cvArr.attrs?.grid_mapping_name) {
        console.info('[explorer] found grid_mapping by name probe:', candidate)
        return candidate
      }
    } catch {}
  }
  return null
}

async function readZarrMeta(url, store) {
  let vars = []
  let timeDimSize = 1
  let shape = null
  let dtype = null
  let dims = null
  let latDim = 'latitude'
  let lonDim = 'longitude'
  let bounds = [-180, -90, 180, 90]
  let latIsAscending = false
  let proj4String = null
  let gridMappingVarName = null

  // ── Path 1: use zarrita (same pattern as zarr-layer) ────────────────
  if (store) {
    try {
      const rootLoc = zarr.root(store)
      const rootGroup = await zarr.open(rootLoc, { kind: 'group' })
      const attrs = rootGroup.attrs || {}
      const multiscales = attrs.multiscales

      // Parse level paths — handle OME-NGFF array and topozarr object formats
      let levelPaths = []
      if (Array.isArray(multiscales) && multiscales.length > 0) {
        levelPaths = (multiscales[0].datasets || []).map(d => d.path).filter(Boolean)
      } else if (multiscales?.layout?.length > 0) {
        levelPaths = multiscales.layout.map(l => l.asset).filter(Boolean)
      }

      // listDir(prefix) returns direct children — use it if available, else fall back
      const listVars = async (prefix) => {
        let children
        if (typeof store.listDir === 'function') {
          children = await store.listDir(prefix)
        } else {
          // Fallback: list all keys and extract first path component under prefix
          const norm = prefix ? prefix + '/' : ''
          const all = await store.list()
          const set = new Set()
          for (const key of all) {
            if (norm && !key.startsWith(norm)) continue
            set.add(key.slice(norm.length).split('/')[0])
          }
          children = [...set]
        }
        return children.filter(n => n && !COORD_NAMES.has(n) && !n.includes('.'))
      }

      let coordPrefix = ''
      if (levelPaths.length > 0) {
        const firstLevel = levelPaths[0]
        coordPrefix = firstLevel + '/'
        vars = await listVars(firstLevel)
        console.info('vars discovered:', vars)

        if (vars.length > 0) {
          // Use rootLoc (Location) for resolve, not the opened Group
          const arr = await zarr.open(rootLoc.resolve(`${firstLevel}/${vars[0]}`), { kind: 'array' })
          shape = [...arr.shape]
          dtype = String(arr.dtype)
          dims  = arr.dimension_names
               ?? arr.meta?.dimension_names
               ?? arr.attrs?._ARRAY_DIMENSIONS
               ?? arr.attrs?.dimension_names
               ?? null
          gridMappingVarName = arr.attrs?.grid_mapping ?? null
          console.info('[explorer] arr keys:', Object.keys(arr), 'meta:', arr.meta, 'attrs:', arr.attrs)
          // Fallback: read zarr.json directly from store
          if (!dims) {
            try {
              const bytes = await store.get(`${firstLevel}/${vars[0]}/zarr.json`)
              if (bytes) {
                const meta = JSON.parse(new TextDecoder().decode(bytes))
                dims = meta.dimension_names ?? meta.attributes?._ARRAY_DIMENSIONS ?? null
                if (!gridMappingVarName) gridMappingVarName = meta.attributes?.grid_mapping ?? null
                console.info('[explorer] zarr.json direct read:', meta)
              }
            } catch {}
          }
          // If still no grid_mapping, probe 'coordinates' attr and common CRS var names
          if (!gridMappingVarName) {
            gridMappingVarName = await detectGridMappingVar(rootLoc, coordPrefix, arr.attrs, store)
          }
        }
      } else {
        vars = await listVars('')
        if (vars.length > 0) {
          const arr = await zarr.open(rootLoc.resolve(vars[0]), { kind: 'array' })
          shape = [...arr.shape]
          dtype = String(arr.dtype)
          dims  = arr.dimension_names
               ?? arr.meta?.dimension_names
               ?? arr.attrs?._ARRAY_DIMENSIONS
               ?? arr.attrs?.dimension_names
               ?? null
          gridMappingVarName = arr.attrs?.grid_mapping ?? null
          console.info('[explorer] arr keys:', Object.keys(arr), 'meta:', arr.meta, 'attrs:', arr.attrs)
          // Fallback: read zarr.json directly from store
          if (!dims) {
            try {
              const bytes = await store.get(`${vars[0]}/zarr.json`)
              if (bytes) {
                const meta = JSON.parse(new TextDecoder().decode(bytes))
                dims = meta.dimension_names ?? meta.attributes?._ARRAY_DIMENSIONS ?? null
                if (!gridMappingVarName) gridMappingVarName = meta.attributes?.grid_mapping ?? null
                console.info('[explorer] zarr.json direct read:', meta)
              }
            } catch {}
          }
          // If still no grid_mapping, probe 'coordinates' attr and common CRS var names
          if (!gridMappingVarName) {
            gridMappingVarName = await detectGridMappingVar(rootLoc, coordPrefix, arr.attrs, store)
          }
        }
      }

      // ── Detect spatial dims from array dimension names ───────────────
      const LAT_NAMES = ['latitude', 'lat', 'y']
      const LON_NAMES = ['longitude', 'lon', 'x']
      console.info('[explorer] raw dims:', dims)
      if (dims) {
        latDim = LAT_NAMES.find(n => dims.includes(n)) ?? 'latitude'
        lonDim = LON_NAMES.find(n => dims.includes(n)) ?? 'longitude'
      }

      // ── Read CF grid_mapping → proj4 string ─────────────────────────
      if (gridMappingVarName) {
        try {
          const gmArr = await zarr.open(rootLoc.resolve(coordPrefix + gridMappingVarName), { kind: 'array' })
          proj4String = cfToProjString(gmArr.attrs || {})
          console.info('[explorer] grid_mapping:', gridMappingVarName, '→', proj4String)
        } catch {}
      }

      // ── Read 1D coordinate arrays to determine bounds + direction ────
      for (const [dim, isLat] of [[latDim, true], [lonDim, false]]) {
        try {
          const cArr = await zarr.open(rootLoc.resolve(coordPrefix + dim), { kind: 'array' })
          if (cArr.shape.length === 1 && cArr.shape[0] <= 50000) {
            const { data } = await zarr.get(cArr, null)
            const v0 = data[0], v1 = data[data.length - 1]
            if (isLat) {
              latIsAscending = v1 > v0
              bounds[1] = Math.min(v0, v1)
              bounds[3] = Math.max(v0, v1)
            } else {
              bounds[0] = Math.min(v0, v1)
              bounds[2] = Math.max(v0, v1)
            }
          }
        } catch {}
      }
      // For geographic data, validate bounds are in degrees; for projected, keep CRS units
      if (!proj4String && (bounds[1] < -90 || bounds[3] > 90 || bounds[0] < -360 || bounds[2] > 360)) {
        bounds = [-180, -90, 180, 90]
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
  } else if (shape && shape.length >= 3) {
    // Fallback: CF convention puts time first in 3D+ arrays
    timeDimSize = shape[0]
  }

  return { vars, shape, dtype, dims, timeDimSize, latDim, lonDim, bounds, latIsAscending, proj4String }
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

  const latDim        = currentMeta.latDim     || 'latitude'
  const lonDim        = currentMeta.lonDim     || 'longitude'
  const bounds        = currentMeta.bounds     || [-180, -90, 180, 90]
  const latIsAscending = currentMeta.latIsAscending ?? false
  const proj4String   = currentMeta.proj4String || null
  console.info(`[explorer] lat=${latDim} lon=${lonDim} bounds=${bounds} latAsc=${latIsAscending} proj4=${proj4String}`)

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
    spatialDimensions: { lat: latDim, lon: lonDim },
    latIsAscending,
    bounds,
    ...(proj4String ? { proj4: proj4String } : {}),
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
