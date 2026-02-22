/**
 * useDataLoader
 * Loads the three static data files produced by the Python pipeline:
 *   areas.geojson  – Borough boundaries (GeoJSON FeatureCollection)
 *   features.json  – Month × Borough panel with all risk metrics
 *   meta.json      – Month list, area index, field descriptions
 *
 * All three are fetched in parallel and cached for the lifetime of the app.
 * Returns { areas, features, meta, loading, error }.
 */

import { useState, useEffect } from 'react'

const BASE = import.meta.env.BASE_URL   // '/' in dev, '/repo-name/' in prod

async function fetchJson(path) {
  const res = await fetch(BASE + path)
  if (!res.ok) throw new Error(`Failed to load ${path} (HTTP ${res.status})`)
  return res.json()
}

export function useDataLoader() {
  const [areas,    setAreas]    = useState(null)
  const [features, setFeatures] = useState(null)
  const [meta,     setMeta]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    let cancelled = false

    Promise.all([
      fetchJson('data/areas.geojson'),
      fetchJson('data/features.json'),
      fetchJson('data/meta.json'),
    ])
      .then(([areasData, featuresData, metaData]) => {
        if (cancelled) return
        setAreas(areasData)
        setFeatures(featuresData)
        setMeta(metaData)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  return { areas, features, meta, loading, error }
}
