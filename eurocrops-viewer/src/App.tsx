import React, { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { deserialize } from 'flatgeobuf/lib/mjs/geojson'
import { FeatureCollection } from 'geojson'

const EUROCROPS_URL = 'https://data.source.coop/cholmes/eurocrops/eurocrops-harmonized-only.fgb'

// Chrome refuses to cache 206 Partial Content responses, causing ERR_CACHE_OPERATION_NOT_SUPPORTED
// which makes the fetch fail. Bypass the cache for range requests to this host.
const _origFetch = window.fetch.bind(window)
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
  if (url.includes('data.source.coop')) {
    init = { ...init, cache: 'no-store' }
  }
  return _origFetch(input, init)
}
const MAX_FEATURES = 2000

const App: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [loading, setLoading] = useState(false)
  const [featureCount, setFeatureCount] = useState(0)
  const [selectedProps, setSelectedProps] = useState<any | null>(null)
  const [zoom, setZoom] = useState(4)

  useEffect(() => {
    if (!mapContainerRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [10, 50],
      zoom: 4,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-left')

    map.on('zoom', () => {
      setZoom(Math.round(map.getZoom() * 10) / 10)
    })

    map.on('load', () => {
      map.addSource('eurocrops', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      })

      map.addLayer({
        id: 'eurocrops-fill',
        type: 'fill',
        source: 'eurocrops',
        paint: {
          'fill-color': '#4caf6e',
          'fill-opacity': 0.4,
          'fill-outline-color': '#ffffff'
        }
      })

      fetchFeatures(map)
    })

    const debouncedFetch = debounce(() => fetchFeatures(map), 500)
    map.on('moveend', debouncedFetch)

    map.on('click', 'eurocrops-fill', (e) => {
      if (e.features && e.features.length > 0) {
        setSelectedProps(e.features[0].properties)
      }
    })

    map.on('mouseenter', 'eurocrops-fill', () => {
      map.getCanvas().style.cursor = 'pointer'
    })

    map.on('mouseleave', 'eurocrops-fill', () => {
      map.getCanvas().style.cursor = ''
    })

    mapRef.current = map

    return () => {
      map.remove()
    }
  }, [])

  const fetchFeatures = async (map: maplibregl.Map) => {
    const bounds = map.getBounds()
    const rect = {
      minX: bounds.getWest(),
      minY: bounds.getSouth(),
      maxX: bounds.getEast(),
      maxY: bounds.getNorth()
    }

    // Only fetch if zoomed in enough that parcels are visible (~25m/pixel at zoom 12)
    if (map.getZoom() < 12) {
      setFeatureCount(0)
      const source = map.getSource('eurocrops') as maplibregl.GeoJSONSource
      source?.setData({ type: 'FeatureCollection', features: [] })
      return
    }

    setLoading(true)
    const features: any[] = []
    try {
      const iter = deserialize(EUROCROPS_URL, rect)
      for await (const feature of iter) {
        features.push(feature)
        if (features.length >= MAX_FEATURES) break
      }

      const source = map.getSource('eurocrops') as maplibregl.GeoJSONSource
      if (source) {
        source.setData({
          type: 'FeatureCollection',
          features: features
        } as FeatureCollection)
      }
      setFeatureCount(features.length)
    } catch (err) {
      console.error('FGB fetch failed:', err)
    } finally {
      setLoading(false)
    }
  }

  function debounce(fn: Function, ms: number) {
    let timer: any
    return (...args: any[]) => {
      clearTimeout(timer)
      timer = setTimeout(() => fn(...args), ms)
    }
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      
      {/* Sidebar Info */}
      <div style={{
        position: 'absolute',
        top: 20,
        right: 20,
        width: 300,
        background: 'rgba(20, 24, 30, 0.9)',
        padding: 20,
        borderRadius: 8,
        border: '1px solid #333',
        zIndex: 1,
        maxHeight: '90vh',
        overflowY: 'auto'
      }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>EuroCrops Viewer</h2>
        <div style={{ fontSize: 13, color: '#aaa', marginBottom: 8 }}>
          Zoom: <span style={{ color: '#fff', fontWeight: 'bold' }}>{zoom.toFixed(1)}</span>
        </div>
        <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
          Zoom in to level 12+ to see individual agricultural parcels. Try zooming into the Netherlands, Germany, or France.
        </p>

        {loading && <div style={{ color: '#f0a500', fontSize: 14 }}>Fetching features...</div>}
        {!loading && zoom < 12 && (
          <div style={{ color: '#888', fontSize: 14 }}>Zoom in to see parcels.</div>
        )}
        {!loading && zoom >= 12 && (
          <div style={{ color: '#4caf6e', fontSize: 14, fontWeight: 'bold' }}>
            {featureCount === MAX_FEATURES ? `Loaded ${MAX_FEATURES}+ features` : `Found ${featureCount} features`}
          </div>
        )}

        <div style={{ borderTop: '1px solid #333', marginTop: 16, paddingTop: 16 }}>
          {selectedProps ? (
            <div>
              <h3 style={{ fontSize: 14, marginBottom: 8, color: '#aaa' }}>Feature Details</h3>
              <pre style={{ fontSize: 11, background: '#000', padding: 8, borderRadius: 4, overflowX: 'auto' }}>
                {JSON.stringify(selectedProps, null, 2)}
              </pre>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: '#666' }}>Click a parcel to see its properties.</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
