import maplibregl from 'maplibre-gl'
import { ZarrLayer } from '@carbonplan/zarr-layer'
import { IcechunkStore } from '@carbonplan/icechunk-js'

// ---------------------------------------------------------------------------
// Config — derive icechunk store URL from STAC item on R2
// ---------------------------------------------------------------------------
const STAC_URL = import.meta.env.VITE_STAC_URL

async function getIcechunkUrl() {
  const resp = await fetch(STAC_URL)
  if (!resp.ok) throw new Error(`STAC fetch failed: ${resp.status} ${STAC_URL}`)
  const item = await resp.json()

  // Find the pyramid asset (has icechunk:snapshot_id)
  const asset = Object.values(item.assets).find(a => a['icechunk:snapshot_id'])
  if (!asset) throw new Error('No icechunk asset found in STAC item')

  const ref    = asset['storage:refs'][0]
  const scheme = item['storage:schemes'][ref]
  const bucket = scheme.bucket
  // href is s3://bucket/prefix/ — extract the prefix
  const prefix = asset.href.replace(`s3://${bucket}/`, '').replace(/\/$/, '')

  // Use the public custom-domain URL (CORS-enabled) rather than the S3 endpoint
  return `https://r2-pub.openscicomp.io/${prefix}`
}

const DATES = [
  '2000-01-01',
  '2000-01-02',
  '2000-01-03',
  '2000-01-04',
  '2000-01-05',
]

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

// ---------------------------------------------------------------------------
// Status helper
// ---------------------------------------------------------------------------
const statusEl = document.getElementById('status')
function setStatus(msg, cls = '') {
  statusEl.textContent = msg
  statusEl.className = cls
}

const MAX_LEVEL = 3  // pyramid has 4 levels (0 = full res, 3 = coarsest)
const levelEl = document.getElementById('level-display')
function updateLevel() {
  const level = MAX_LEVEL - Math.min(Math.max(0, Math.floor(map.getZoom())), MAX_LEVEL)
  levelEl.textContent = `level: ${level}`
}
map.on('zoom', updateLevel)
map.on('load', updateLevel)

// ---------------------------------------------------------------------------
// Open IceChunk store (lazy singleton, URL resolved from STAC)
// ---------------------------------------------------------------------------
let _storePromise = null
function getStore() {
  return (_storePromise ??= getIcechunkUrl().then(url =>
    IcechunkStore.open(url, {
      branch: 'main',
      formatVersion: 'v1',
      cache: 'no-store',
    })
  ).catch((err) => {
    _storePromise = null
    throw err
  }))
}

// ---------------------------------------------------------------------------
// Colormaps — zarr-layer requires an array of hex strings
// ---------------------------------------------------------------------------
const COLORMAPS = {
  ylgn: [
    '#ffffe5','#f7fcb9','#d9f0a3','#addd8e',
    '#78c679','#41ab5d','#238443','#006837','#004529',
  ],
  rdylgn: [
    '#a50026','#d73027','#f46d43','#fdae61','#fee08b',
    '#ffffbf','#d9ef8b','#a6d96a','#66bd63','#1a9850','#006837',
  ],
  viridis: [
    '#440154','#482878','#3e4989','#31688e','#26828e',
    '#1f9e89','#35b779','#6ece58','#b5de2b','#fde725',
  ],
  plasma: [
    '#0d0887','#46039f','#7201a8','#9c179e','#bd3786',
    '#d8576b','#ed7953','#fb9f3a','#fdcf18','#f0f921',
  ],
  greens: [
    '#f7fcf5','#e5f5e0','#c7e9c0','#a1d99b',
    '#74c476','#41ab5d','#238b45','#006d2c','#00441b',
  ],
}

// ---------------------------------------------------------------------------
// Layer state
// ---------------------------------------------------------------------------
let layer = null
let state = {
  time: 0,
  colormap: 'ylgn',
  clim: [-0.1, 1.0],
  opacity: 0.85,
}

async function addLayer() {
  setStatus('loading store…')

  let store, icechunkUrl
  try {
    icechunkUrl = await getIcechunkUrl()
    store = await getStore()
  } catch (err) {
    setStatus('store error — check VITE_STAC_URL', 'error')
    console.error('IcechunkStore.open failed:', err)
    return
  }

  layer = new ZarrLayer({
    id: 'ndvi',
    source: icechunkUrl,
    store,
    variable: 'NDVI',
    clim: state.clim,
    colormap: COLORMAPS[state.colormap],
    opacity: state.opacity,
    zarrVersion: 3,
    selector: { time: { selected: state.time, type: 'index' } },
    // lat/lon dimension names as written by topozarr
    spatialDimensions: { lat: 'latitude', lon: 'longitude' },
    latIsAscending: false,
    bounds: [-180, -90, 180, 90],
  })

  map.addLayer(layer)
  setStatus('rendering…')
  map.once('idle', () => setStatus('ready', 'ready'))
}

map.on('load', addLayer)

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
function debounce(fn, ms) {
  let timer
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms) }
}

const timeSlider = document.getElementById('time-slider')
const timeLabel  = document.getElementById('time-label')
const debouncedSetTime = debounce((t) => {
  layer?.setSelector({ time: { selected: t, type: 'index' } })
}, 150)
timeSlider.addEventListener('input', () => {
  state.time = Number(timeSlider.value)
  timeLabel.textContent = DATES[state.time]
  debouncedSetTime(state.time)
})

const colormapSelect = document.getElementById('colormap-select')
colormapSelect.addEventListener('change', () => {
  state.colormap = colormapSelect.value
  layer?.setColormap(COLORMAPS[state.colormap])
})

const climMin = document.getElementById('clim-min')
const climMax = document.getElementById('clim-max')
function updateClim() {
  state.clim = [Number(climMin.value), Number(climMax.value)]
  layer?.setClim(state.clim)
}
climMin.addEventListener('change', updateClim)
climMax.addEventListener('change', updateClim)

const opacitySlider = document.getElementById('opacity-slider')
const opacityLabel  = document.getElementById('opacity-label')
opacitySlider.addEventListener('input', () => {
  state.opacity = Number(opacitySlider.value)
  opacityLabel.textContent = state.opacity.toFixed(2)
  layer?.setOpacity(state.opacity)
})
